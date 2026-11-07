-- wrk script for run.py: ROUTE is one of the routes of common.js, with random
-- parameters in every request where the route takes them.
local route = os.getenv("ROUTE")

request = function()
  if route == "queries" or route == "updates" then
    return wrk.format("GET", "/" .. route .. "?n=20")
  elseif route == "search" then
    local lo = math.random(0, 900)
    return wrk.format("GET", string.format("/search?c=%d&min=%d&max=%d&page=%d",
      math.random(0, 999), lo, lo + math.random(10, 100), math.random(0, 1)))
  elseif route == "report" then
    return wrk.format("GET", "/report?c=" .. math.random(0, 999))
  end
  return wrk.format("GET", "/" .. route)
end
