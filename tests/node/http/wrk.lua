-- wrk script for run.py: ROUTE=hello|compute|catalog, a random seed or
-- category in every request.
local route = os.getenv("ROUTE")

request = function()
  if route == "hello" then
    return wrk.format("GET", "/hello")
  end
  local n = math.random(0, 999)
  if route == "compute" then
    return wrk.format("GET", "/compute?seed=" .. n)
  end
  return wrk.format("GET", "/catalog?c=" .. n)
end
