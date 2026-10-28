-- Keys deliberately share a hash tag for a future clustered Redis deployment.
-- All writes below execute without interleaving. Redis must use noeviction.
local previous = redis.call('GET', KEYS[2])
if previous then
  local value = cjson.decode(previous)
  if value.customerId ~= ARGV[2] or value.productId ~= ARGV[3] then
    return {'conflict'}
  end
  return {'existing', previous}
end
local tokens = redis.call('GET', KEYS[1])
if not tokens then return {'uninitialized'} end
if tonumber(tokens) <= 0 then return {'unavailable'} end
local record = cjson.encode({attemptId=ARGV[1], customerId=ARGV[2], productId=ARGV[3], quantity=1, status='pending'})
redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], record)
redis.call('XADD', KEYS[3], '*', 'payload', record)
return {'accepted', record}
