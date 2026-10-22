#include "animocap/pose_review.hpp"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <tuple>

namespace animocap {
namespace {
using Channels = std::array<double,5>;
Channels channels(const ObservedJoint& j) {
    return {j.position_m.x,j.position_m.y,j.position_m.z,j.image_xy.x,j.image_xy.y};
}
void set_channels(ObservedJoint& j,const Channels& v) {
    j.position_m={v[0],v[1],v[2]}; j.image_xy={v[3],v[4]};
}
}
PoseReviewResult rebuild_reviewed_pose(const PoseSequence& source,const PoseReview& review) {
    validate_pose_sequence(source);
    PoseReviewResult out{source,{}};
    const auto frames=source.frames.size();
    if(!frames) {
        if(!review.marks.empty()||!review.ranges.empty())throw ContractError("Review requires pose frames");
        return out;
    }
    const auto joints=source.frames.front().joints.size();
    out.inferred.resize(frames*joints,false);
    std::vector<const JointReview*> marks(frames*joints,nullptr);
    for(const auto& mark:review.marks) {
        if(mark.frame>=frames||mark.joint>=joints)throw ContractError("Review sample outside clip");
        auto& slot=marks[mark.frame*joints+mark.joint];
        if(slot)throw ContractError("Duplicate review sample");
        if(mark.trust!=ReviewTrust::Excluded&&mark.trust!=ReviewTrust::Locked&&mark.trust!=ReviewTrust::Weighted)
            throw ContractError("Unknown review trust");
        if(!std::isfinite(mark.weight)||mark.weight<1||mark.weight>100)
            throw ContractError("Review weight must be in [1,100]");
        if(mark.trust!=ReviewTrust::Excluded) {
            if(!mark.target.valid)throw ContractError("Cannot trust a missing joint");
            for(double x:channels(mark.target))if(!std::isfinite(x))throw ContractError("Non-finite review target");
            if(!std::isfinite(mark.target.confidence)||mark.target.confidence<0||mark.target.confidence>1)
                throw ContractError("Invalid review confidence");
        }
        slot=&mark;
        if(mark.trust==ReviewTrust::Locked)out.sequence.frames[mark.frame].joints[mark.joint]=mark.target;
    }
    // Merge overlapping requested regions per joint; solve each sample only once.
    std::vector<ReviewRange> ranges=review.ranges;
    for(const auto& r:ranges) {
        if(r.first>=r.last||r.last>=frames||r.joint>=joints)throw ContractError("Invalid review interval");
        for(auto f:{r.first,r.last}) {
            const auto m=marks[f*joints+r.joint];
            if(!m||m->trust!=ReviewTrust::Locked)throw ContractError("Lock the selected joint at both interval endpoints first");
        }
    }
    std::sort(ranges.begin(),ranges.end(),[](auto a,auto b){return std::tie(a.joint,a.first)<std::tie(b.joint,b.first);});
    std::vector<ReviewRange> merged;
    for(auto r:ranges) {
        if(!merged.empty()&&merged.back().joint==r.joint&&r.first<=merged.back().last)
            merged.back().last=std::max(merged.back().last,r.last);
        else merged.push_back(r);
    }
    for(const auto& range:merged) {
        const auto n=range.last-range.first+1;
        std::vector<double> weights(n),fixed(n);
        std::vector<Channels> target(n),values(n);
        std::vector<bool> missing(n);
        for(std::size_t i=0;i<n;++i) {
            const auto f=range.first+i;
            const auto& obs=source.frames[f].joints[range.joint];
            const auto m=marks[f*joints+range.joint];
            missing[i]=(m&&m->trust==ReviewTrust::Excluded)||(!obs.valid&&!m);
            fixed[i]=m&&m->trust==ReviewTrust::Locked;
            if(!missing[i]) {
                target[i]=channels(m?m->target:obs);
                weights[i]=m?m->weight:std::max(0.05,static_cast<double>(obs.confidence));
            }
        }
        // Require short, bounded gaps. Rejected coordinates never enter the system.
        for(std::size_t i=0;i<n;) {
            if(!missing[i]){++i;continue;}
            const auto start=i;
            while(i<n&&missing[i])++i;
            if(start==0||i==n)throw ContractError("Missing interval endpoint");
            const auto left=start-1,right=i;
            const double t0=source.frames[range.first+left].time_s;
            const double t1=source.frames[range.first+right].time_s;
            if(t1-t0>0.75)throw ContractError("Gap exceeds 0.75 seconds; add a corrected trusted joint inside it");
        }
        // SPD least squares: fidelity plus changes in velocity, with hard variables eliminated.
        // A direct banded Cholesky solve avoids iteration-count-dependent anchor influence.
        std::vector<std::array<double,3>> a(n); // diagonal, lower 1, lower 2
        std::vector<Channels> rhs(n);
        for(std::size_t i=0;i<n;++i) {
            a[i][0]=weights[i];
            for(std::size_t c=0;c<5;++c)rhs[i][c]=weights[i]*target[i][c];
        }
        for(std::size_t i=1;i+1<n;++i) {
            const double dt0=(source.frames[range.first+i].time_s-source.frames[range.first+i-1].time_s)*source.fps;
            const double dt1=(source.frames[range.first+i+1].time_s-source.frames[range.first+i].time_s)*source.fps;
            const double d[3]{1/dt0,-1/dt0-1/dt1,1/dt1};
            for(std::size_t u=0;u<3;++u)for(std::size_t v=0;v<=u;++v)
                a[i-1+u][u-v]+=2.0*d[u]*d[v];
        }
        for(std::size_t i=0;i<n;++i)if(fixed[i]) {
            for(std::size_t k=i>2?i-2:0;k<std::min(n,i+3);++k) {
                if(k==i)continue;
                auto& coefficient=a[std::max(i,k)][i>k?i-k:k-i];
                for(std::size_t c=0;c<5;++c)rhs[k][c]-=coefficient*target[i][c];
                coefficient=0;
            }
            a[i][0]=1;rhs[i]=target[i];
        }
        for(std::size_t i=0;i<n;++i) {
            if(i>=2)a[i][2]/=a[i-2][0];
            if(i>=1)a[i][1]=(a[i][1]-(i>=2?a[i][2]*a[i-1][1]:0))/a[i-1][0];
            const double diagonal=a[i][0]-a[i][1]*a[i][1]-a[i][2]*a[i][2];
            if(!(diagonal>0)||!std::isfinite(diagonal))throw ContractError("Unsolvable review interval");
            a[i][0]=std::sqrt(diagonal);
            for(std::size_t c=0;c<5;++c)rhs[i][c]=(rhs[i][c]-(i>=1?a[i][1]*rhs[i-1][c]:0)-(i>=2?a[i][2]*rhs[i-2][c]:0))/a[i][0];
        }
        for(std::size_t i=n;i-->0;)for(std::size_t c=0;c<5;++c)
            values[i][c]=(rhs[i][c]-(i+1<n?a[i+1][1]*values[i+1][c]:0)-(i+2<n?a[i+2][2]*values[i+2][c]:0))/a[i][0];
        for(std::size_t i=0;i<n;++i) {
            const auto f=range.first+i;
            auto& dst=out.sequence.frames[f].joints[range.joint];
            if(fixed[i])dst=marks[f*joints+range.joint]->target;
            else {
                set_channels(dst,values[i]);dst.valid=true;
                if(missing[i]) {dst.confidence=0;out.inferred[f*joints+range.joint]=true;}
            }
        }
    }
    validate_pose_sequence(out.sequence);
    return out;
}
void save_pose_review(const PoseSequence& base,const PoseReview& review,const std::filesystem::path& path) {
    (void)rebuild_reviewed_pose(base,review);
    if(std::filesystem::exists(path))throw ContractError("Review folder already exists");
    std::filesystem::create_directories(path);
    save_pose_sequence_json(base,path/"source.json");
    nlohmann::json value{{"version",1},{"marks",nlohmann::json::array()},{"ranges",nlohmann::json::array()}};
    for(const auto& m:review.marks)value["marks"].push_back({{"frame",m.frame},{"joint",m.joint},{"trust",static_cast<int>(m.trust)},
        {"weight",m.weight},{"target",channels(m.target)},{"valid",m.target.valid},{"confidence",m.target.confidence}});
    for(const auto& r:review.ranges)value["ranges"].push_back({r.first,r.last,r.joint});
    std::ofstream output(path/"review.json");output<<value.dump(2);
    if(!output)throw ContractError("Cannot write review state");
}
std::pair<PoseSequence,PoseReview> load_pose_review(const std::filesystem::path& path) {
    auto base=load_pose_sequence_json(path/"source.json");
    std::ifstream input(path/"review.json");nlohmann::json value;input>>value;
    if(value.at("version")!=1)throw ContractError("Unsupported review version");
    PoseReview review;
    for(const auto& v:value.at("marks")) {
        JointReview m;m.frame=v.at("frame");m.joint=v.at("joint");m.trust=static_cast<ReviewTrust>(v.at("trust").get<int>());
        m.weight=v.at("weight");set_channels(m.target,v.at("target").get<Channels>());
        m.target.valid=v.at("valid");m.target.confidence=v.at("confidence");review.marks.push_back(m);
    }
    for(const auto& v:value.at("ranges"))review.ranges.push_back({v.at(0),v.at(1),v.at(2)});
    (void)rebuild_reviewed_pose(base,review);
    return {std::move(base),std::move(review)};
}
} // namespace animocap
