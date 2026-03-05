from rest_framework.throttling import SimpleRateThrottle


# 节流器，限制邮箱验证码接口每个邮箱只能访问5次
class DailyThrottle(SimpleRateThrottle):
    rate = '5/day'

    def get_cache_key(self, request, view):
        email = request.data.get("email")
        if not email:
            return None
        return f"DailyThrottle:{email.replace('.', '_')}"

    def allow_request(self, request, view):
        self.scope = request.data.get("email")
        return super().allow_request(request, view)


# 节流器，限制访问1分钟1次，通过缓存中存储的key来实现每个邮箱一分钟只能访问一次邮箱验证码接口
class MinuteThrottle(SimpleRateThrottle):
    rate = '1/min'

    def get_cache_key(self, request, view):
        email = request.data.get("email")
        if not email:
            return None
        return f"MinuteThrottle:{email.replace('.', '_')}"

    def allow_request(self, request, view):
        self.scope = request.data.get("email")
        return super().allow_request(request, view)

