import test from 'node:test'
import assert from 'node:assert/strict'
import { loginDestination, loginReturnPath } from '../../src/utils/loginDestination.js'
import { readFileSync } from 'node:fs'

const tacticalSource = readFileSync(new URL('../../src/pages/TacticalCollaboration.jsx', import.meta.url), 'utf8')

test('login return defaults preserve existing navigation', () => {
  assert.equal(loginDestination(''), '/fraudlist')
  assert.equal(loginDestination('?next=/starsea/new'), '/starsea/new')
  assert.equal(loginDestination('?next=%2Fstarsea%2F12%2Fedit'), '/starsea/12/edit')
  assert.equal(loginDestination('?next=/starsea/review'), '/starsea/review')
  assert.equal(loginDestination('?next=%2Fstarsea%2Freview%2F12'), '/starsea/review/12')
  assert.equal(loginDestination('?next=%2Ftactical%3Forganization%3D7'), '/tactical?organization=7')
})
test('login return accepts only known paths, never an external or unsafe destination', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/starsea/../../login', '/starsea-evil', '/login', '/fraudlogin', '/access-denied', '/tactical?organization=abc', '/starsea/%2f%2fevil', '/starsea/new?next=https://evil.test', '/market?next=https://evil.test', '/killboard/0', '/corporations/-1', '/usersetting#https://evil.test', '/market\n', '/starsea/new\n', '/killboard/123\r', '/MARKET']) {
    assert.equal(loginDestination(`?next=${encodeURIComponent(value)}`), '/fraudlist')
  }
})

test('login can return to existing tools and guarded detail pages', () => {
  for (const path of ['/', '/market', '/market/admin', '/manufacturing', '/planetary', '/starmap', '/tactical', '/tactical/usage', '/usersetting', '/fraudadmin', '/licenseadmin', '/feedback', '/infocenter', '/corporations', '/corporations/manage', '/corporations/review', '/corporations/12', '/killboard', '/killboard/admin', '/killboard/198321']) {
    assert.equal(loginDestination(`?next=${encodeURIComponent(path)}`), path)
    assert.equal(loginDestination('', path), path)
  }
})

test('guard state is validated and an explicit safe return has priority', () => {
  assert.equal(loginDestination('', '/usersetting'), '/usersetting')
  assert.equal(loginDestination('?next=%2Fmarket', '/usersetting'), '/market')
  assert.equal(loginDestination('?next=https%3A%2F%2Fevil.test', '/usersetting'), '/usersetting')
  for (const from of ['//evil.test', '/login', { pathname: '/usersetting' }, null]) {
    assert.equal(loginDestination('', from), '/fraudlist')
  }
})

test('guard captures a known page and preserves only supported route parameters', () => {
  assert.equal(loginReturnPath({ pathname: '/tactical', search: '?organization=7' }), '/tactical?organization=7')
  assert.equal(loginReturnPath({ pathname: '/market', search: '?next=https://evil.test' }), '/market')
  assert.equal(loginReturnPath({ pathname: '/usersetting' }), '/usersetting')
  assert.equal(loginReturnPath({ pathname: '//evil.test', search: '' }), '/fraudlist')
})

test('tactical login entry preserves the current organization URL', () => {
  assert.doesNotMatch(tacticalSource, /to="\/login"/)
  assert.match(tacticalSource, /next=/)
})
