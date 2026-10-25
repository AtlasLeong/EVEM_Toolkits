import logging
import smtplib
import ssl
import math

import certifi
from django.core.mail.backends.smtp import EmailBackend

logger = logging.getLogger(__name__)


class CustomEmailBackend(EmailBackend):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.timeout is None:
            self.timeout = 10
        if (isinstance(self.timeout, bool) or not isinstance(self.timeout, (int, float))
                or not 0 < self.timeout <= 30 or not math.isfinite(self.timeout)):
            raise ValueError('SMTP timeout must be a finite number greater than zero and at most 30 seconds.')

    def _discard_connection(self):
        connection, self.connection = self.connection, None
        if connection is not None:
            try:
                # Do not send QUIT to a connection that has already timed out.
                connection.close()
            except Exception:
                logger.warning('Failed to close a failed SMTP connection')

    def open(self):
        if self.connection:
            return False
        try:
            context = ssl.create_default_context(cafile=certifi.where())
            self.connection = smtplib.SMTP_SSL(self.host, self.port, context=context, timeout=self.timeout)
            if self.username and self.password:
                self.connection.login(self.username, self.password)
        except Exception:
            self._discard_connection()
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

    def _send(self, email_message):
        if self.connection is None:
            return False
        try:
            return super()._send(email_message)
        except OSError:
            # Django's send_messages does not close after _send raises. Discard
            # partial/failed delivery state, and preserve fail_silently behavior.
            self._discard_connection()
            if not self.fail_silently:
                raise
            return False
