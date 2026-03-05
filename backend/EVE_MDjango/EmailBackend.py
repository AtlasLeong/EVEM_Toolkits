from django.core.mail.backends.smtp import EmailBackend
import ssl
import certifi
import smtplib


class CustomEmailBackend(EmailBackend):
    def open(self):
        if self.connection:
            return False
        try:
            # 创建 SSL 上下文
            context = ssl.create_default_context(cafile=certifi.where())
            # 初始化 SMTP_SSL 连接
            self.connection = smtplib.SMTP_SSL(self.host, self.port, context=context)
            # 登录到邮件服务器
            if self.username and self.password:
                self.connection.login(self.username, self.password)
        except Exception:
            if not self.fail_silently:
                raise
            return False
        return True
