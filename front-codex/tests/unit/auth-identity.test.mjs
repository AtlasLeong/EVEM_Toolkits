import test from 'node:test'
import assert from 'node:assert/strict'
import { getUserInfo } from '../../src/services/getJWTUserInfo.js'

const jwt = body => `header.${Buffer.from(JSON.stringify(body)).toString('base64url')}.signature`
test('access-only sessions identify the current account and switch without retaining previous identity',()=>{
  const values = new Map([['access_token',jwt({user_id:23,username:'scout-a'})]])
  globalThis.localStorage={getItem:key=>values.get(key)||null}
  assert.deepEqual(getUserInfo(),{userId:23,userName:'scout-a'})
  values.set('access_token',jwt({user_id:24,username:'commander-b'}))
  assert.deepEqual(getUserInfo(),{userId:24,userName:'commander-b'})
  values.set('refresh_token',jwt({user_id:25,username:'refresh-owner'}))
  assert.deepEqual(getUserInfo(),{userId:25,userName:'refresh-owner'})
  values.clear()
  assert.equal(getUserInfo(),null)
  delete globalThis.localStorage
})
