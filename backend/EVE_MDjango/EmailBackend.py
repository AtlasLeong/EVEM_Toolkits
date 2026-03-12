import logging
import smtplib
import ssl

import certifi
from django.core.mail.backends.smtp import EmailBackend

logger = logging.getLogger(__name__)


class CustomEmailBackend(EmailBackend):
    def open(self):
        if self.connection:
            return False
        try:
            context = ssl.create_default_context(cafile=certifi.where())
            self.connection = smtplib.SMTP_SSL(self.host, self.port, context=context)
            if self.username and self.password:
                self.connection.login(self.username, self.password)
        except Exception:
            logger.exception(
                'Failed to open SMTP connection host=%s port=%s username=%s',
                self.host,
                self.port,
                self.username,
            )
            if not self.fail_silently:
                raise
            return False
        return True
