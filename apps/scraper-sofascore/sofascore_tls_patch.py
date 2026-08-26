"""Ép `tls_requests` chạy HTTP/1.1 (tránh QUIC — nghi bị chặn trên Render). `soccerdata` không
expose tham số `http2` nên phải monkeypatch `BaseReader._init_session`.
"""

import soccerdata._common as _sd_common
import tls_requests


def apply() -> None:
    def _init_session_http1(self, headers=None):
        return tls_requests.Client(proxy=self.proxy(), headers=headers, http2="http1")

    _sd_common.BaseReader._init_session = _init_session_http1
