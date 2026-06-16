const HTTP_API_TOKEN_KEY = "yolo_workbench_http_api_token";

function httpBackendHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = httpBackendToken();
  if (token) headers["X-Yolo-WorkBench-Token"] = token;
  return headers;
}

function httpBackendToken() {
  const params = new URLSearchParams(location.search);
  const token = params.get("apiToken") || params.get("token");
  if (token) {
    try {
      sessionStorage.setItem(HTTP_API_TOKEN_KEY, token);
      params.delete("apiToken");
      params.delete("token");
      const cleanQuery = params.toString();
      const cleanUrl = `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${location.hash}`;
      history.replaceState(null, "", cleanUrl);
    } catch {
      // Keep working even if sessionStorage or history APIs are blocked.
    }
    return token;
  }
  try {
    return sessionStorage.getItem(HTTP_API_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
