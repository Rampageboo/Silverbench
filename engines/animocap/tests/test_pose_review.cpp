#include "animocap/pose_review.hpp"
#include "animocap/skeleton.hpp"
#include <cmath>
#include <iostream>
namespace {
int failures=0;
#define CHECK(x) do {if(!(x)){std::cerr<<"FAIL "<<__LINE__<<": "<<#x<<'\n';++failures;}}while(false)
#define THROWS(x) do {bool threw=false;try{(void)(x);}catch(const std::exception&){threw=true;}CHECK(threw);}while(false)
bool same(const animocap::ObservedJoint& a,const animocap::ObservedJoint& b) {
    return a.position_m.x==b.position_m.x&&a.position_m.y==b.position_m.y&&a.position_m.z==b.position_m.z&&
        a.image_xy.x==b.image_xy.x&&a.image_xy.y==b.image_xy.y&&a.valid==b.valid&&a.confidence==b.confidence;
}
animocap::PoseSequence fixture() {
    animocap::PoseSequence s;s.backend="review-test";s.source_video="fixture.mp4";s.fps=30;s.image_width=640;s.image_height=480;
    const auto skeleton=animocap::make_default_skeleton();
    for(std::size_t f=0;f<40;++f) {
        animocap::ObservedPoseFrame frame;frame.time_s=f/30.0;
        for(std::size_t j=0;j<skeleton.bones.size();++j) {
            const double x=f*0.01+(f%2?0.009:-0.009);
            frame.joints.push_back({{200+x*100,200},{x,j*0.03,0},0.8f,true});
        }
        s.frames.push_back(frame);
    }
    return s;
}
}
int main(int argc,char** argv) {
    using namespace animocap;
    auto s=fixture();PoseReview review;
    for(auto f:{5u,20u})review.marks.push_back({f,10,ReviewTrust::Locked,s.frames[f].joints[10],8});
    for(auto f:{11u,12u,13u})review.marks.push_back({f,10,ReviewTrust::Excluded,{},8});
    review.ranges.push_back({5,20,10});
    auto r=rebuild_reviewed_pose(s,review);
    for(std::size_t f=0;f<s.frames.size();++f)for(std::size_t j=0;j<s.frames[f].joints.size();++j)
        if(j!=10||f<=5||f>=20)CHECK(same(s.frames[f].joints[j],r.sequence.frames[f].joints[j]));
    auto poison=s;
    for(auto f:{11u,12u,13u}) {poison.frames[f].joints[10].position_m={999,-999,999};poison.frames[f].joints[10].image_xy={100000,-100000};}
    auto clean=rebuild_reviewed_pose(poison,review);
    for(std::size_t f=5;f<=20;++f)CHECK(same(r.sequence.frames[f].joints[10],clean.sequence.frames[f].joints[10]));
    CHECK(r.inferred[12*s.frames[0].joints.size()+10]);CHECK(r.sequence.frames[12].joints[10].confidence==0);
    auto again=rebuild_reviewed_pose(s,review);
    CHECK(same(r.sequence.frames[9].joints[10],again.sequence.frames[9].joints[10]));
    auto trusted=s.frames[9].joints[10];trusted.position_m.x+=0.1;
    review.marks.push_back({9,10,ReviewTrust::Weighted,trusted,4});
    auto low=rebuild_reviewed_pose(s,review);
    review.marks.back().weight=16;auto high=rebuild_reviewed_pose(s,review);
    CHECK(std::abs(high.sequence.frames[9].joints[10].position_m.x-trusted.position_m.x)<
        std::abs(low.sequence.frames[9].joints[10].position_m.x-trusted.position_m.x));
    review.marks.back().trust=ReviewTrust::Locked;auto locked=rebuild_reviewed_pose(s,review);
    CHECK(same(locked.sequence.frames[9].joints[10],trusted));
    auto bad=review;bad.marks.push_back(bad.marks.front());THROWS(rebuild_reviewed_pose(s,bad));
    bad=review;bad.marks.erase(bad.marks.begin());THROWS(rebuild_reviewed_pose(s,bad));
    bad=review;bad.marks.back().weight=NAN;THROWS(rebuild_reviewed_pose(s,bad));
    bad=review;bad.marks.back().frame=999;THROWS(rebuild_reviewed_pose(s,bad));
    PoseReview gap;gap.marks={{0,10,ReviewTrust::Locked,s.frames[0].joints[10],8},{39,10,ReviewTrust::Locked,s.frames[39].joints[10],8}};
    for(std::size_t f=1;f<39;++f)gap.marks.push_back({f,10,ReviewTrust::Excluded,{},8});
    gap.ranges={{0,39,10}};THROWS(rebuild_reviewed_pose(s,gap));
    auto uneven=s;uneven.frames[10].time_s+=0.005;
    CHECK(same(rebuild_reviewed_pose(uneven,review).sequence.frames[9].joints[10],trusted));
    if(argc>1) {
        const auto path=std::filesystem::path(argv[1])/"review-roundtrip";
        save_pose_review(s,review,path);
        auto [base,restored]=load_pose_review(path);
        auto roundtrip=rebuild_reviewed_pose(base,restored);
        for(std::size_t f=0;f<s.frames.size();++f)CHECK(same(locked.sequence.frames[f].joints[10],roundtrip.sequence.frames[f].joints[10]));
        THROWS(save_pose_review(s,review,path));
        save_pose_sequence_json(s,std::filesystem::path(argv[1])/"review-fixture.json");
    }
    std::cout<<"pose review failures: "<<failures<<'\n';return failures?1:0;
}
