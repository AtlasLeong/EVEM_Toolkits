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
        connection = None
        try:
            context = ssl.create_default_context(cafile=certifi.where())
            connection = smtplib.SMTP_SSL(
                self.host, self.port, context=context,
                timeout=self.timeout if self.timeout is not None else 20,
            )
            if self.username and self.password:
                connection.login(self.username, self.password)
        except Exception:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass  # Preserve the original connection/login failure.
            logger.exception(
                'Failed to open SMTP connection host=%s port=%s username=%s',
                self.host,
                self.port,
                self.username,
            )
            if not self.fail_silently:
                raise
            return False
        self.connection = connection
        return True
