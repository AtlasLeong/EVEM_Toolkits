"""Real loopback HTTP lifecycle acceptance; creates only labelled local test posts."""
import io
import json
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from uuid import uuid4
from PIL import Image

BASE = 'http://127.0.0.1:8002/api'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, 'Local test redirects are forbidden', headers, fp)


def local_opener():
    return build_opener(ProxyHandler({}), NoRedirect())


def request(path, body=None, token=None, method=None, expected=200, content_type=None):
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if content_type:
        headers['Content-Type'] = content_type
    call = Request(BASE + path, data=body, headers=headers, method=method or ('POST' if body is not None else 'GET'))
    try:
        response = local_opener().open(call, timeout=20)
    except HTTPError as exc:
        response = exc
    with response:
        data = response.read()
        assert response.status == expected, f'{path}: expected {expected}, got {response.status}: {data[:400]!r}'
        if 'application/json' in response.headers.get('Content-Type', ''):
            return json.loads(data)
        return data


def login(role):
    return request('/user/login', {'login_email': f'{role}@starsea.local', 'login_password': 'Starsea2026'})['access']


def version(entry):
    return {'expected_revision_id': entry['revision']['id'], 'expected_version': entry['revision']['version']}


def smoke():
    owner, reviewer, other = login('pilot'), login('reviewer'), login('another')
    catalog = request('/starsea/ships/?q=')
    assert catalog['count'] > 400
    hull = catalog['results'][0]
    regions = request('/starsea/locations/?kind=regions')['results']
    assert len(regions) > 50
    body = {'kind': 'battle', 'title': '本地验收：双边战损与审核隔离', 'body': '自动化本地验收样本，不代表真实战斗。',
            'occurred_at': None, 'location': {'region_id': regions[0]['id'], 'constellation_id': None, 'solarsystem_id': None},
            'corporation_id': None, 'images': [], 'battle': {'sides': [
                {'name': '测试 A 方', 'isk_loss': None, 'losses': [{'ship_id': hull['id'], 'ship_name': '不可信名称', 'ship_class': '不可信分类', 'quantity': 12}]},
                {'name': '测试 B 方', 'isk_loss': '0', 'losses': [{'ship_id': None, 'ship_name': '', 'ship_class': '战列舰', 'quantity': 3}]},
            ]}}
    post = request('/starsea/posts/', {'request_id': str(uuid4()), 'content': body}, owner, expected=201)
    pid = post['id']
    path = f'/starsea/posts/{pid}'
    assert post['summary']['sides'][0]['total_ships'] == 12
    assert post['summary']['sides'][0]['isk_loss'] is None
    assert post['revision']['content']['battle']['sides'][0]['losses'][0]['ship_name'] == hull['name']
    request(path + '/', expected=404)
    request(path + '/manage/', token=other, expected=404)
    request(path + '/draft/', {**version(post), 'content': {'title': '越权'}}, other, method='PATCH', expected=404)
    old = dict(version(post))
    post = request(path + '/draft/', {**old, 'content': {'body': '保存后的本地战报。'}}, owner, method='PATCH')
    request(path + '/draft/', {**old, 'content': {'body': '过期请求'}}, owner, method='PATCH', expected=409)
    image = io.BytesIO()
    Image.new('RGB', (80, 80), '#243c48').save(image, format='PNG')
    boundary = 'starsea-' + uuid4().hex
    multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="request_id"\r\n\r\n{uuid4()}\r\n'
                 f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="local-km.png"\r\nContent-Type: image/png\r\n\r\n').encode() + image.getvalue() + f'\r\n--{boundary}--\r\n'.encode()
    asset = request(path + '/media/', multipart, owner, expected=201, content_type=f'multipart/form-data; boundary={boundary}')
    request(f"/starsea/media/{asset['id']}/", expected=404)
    assert request(f"/starsea/media/{asset['id']}/", token=owner)
    post = request(path + '/draft/', {**version(post), 'content': {'images': [{'id': asset['id'], 'caption': '本地测试色块，不是游戏 KM'}]}}, owner, method='PATCH')
    post = request(path + '/submit/', version(post), owner)
    request(path + '/', expected=404)
    review = request(f"/starsea/reviews/{post['revision']['id']}/", token=reviewer)
    request(f"/starsea/reviews/{post['revision']['id']}/decision/", {'decision': 'approve', 'reason': '本地验收', 'expected_version': review['revision']['version']}, reviewer)
    published = request(path + '/')
    assert published['revision']['status'] == 'approved'
    assert request(f"/starsea/media/{asset['id']}/")
    post = request(path + '/manage/', token=owner)
    post = request(path + '/draft/', version(post), owner, expected=201)
    post = request(path + '/draft/', {**version(post), 'content': {'title': '这个新标题仍然未审核'}}, owner, method='PATCH')
    assert request(path + '/')['revision']['content']['title'] == published['revision']['content']['title']
    request(path + '/visibility/', {'is_listed': False, 'reason': '本地验收完成，隐藏测试帖'}, reviewer)
    request(path + '/', expected=404)
    request(f"/starsea/media/{asset['id']}/", expected=404)
    print(f'PASS: post {pid}; real catalog, login, owner isolation, conflict, KM image privacy, review, old-public revision and hide.')


if __name__ == '__main__':
    smoke()
