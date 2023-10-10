import { describe, it, expect, assert } from 'vitest'
import { actorClientMock } from './mock'
import linksFrom from '../src/links-from'

function addSendGossip(...peers) {
  for (const peer of peers) {
    peer.send = async (p, m)=> {
      try {
        await p.onMessage(peer, m)
      } catch(e) {}
    }
    peer.gossip = async m=> {
      await Promise.all(peers.map(async p=> {
        if (p != peer) {
          await peer.send(p, m)
        }
      }))
    }
  }
}

describe('Link from', ()=> {

  it('local add and delete', async ()=> {
    const { actor, actorClient } = actorClientMock()
    const lf = new (linksFrom(actorClient))("something cool!")

    const recieved = []
    lf.addListener((m)=> {
      recieved.push(m)
    })

    const target = "hello world"
    const postCap = await lf.createPostCapability(target, actor)

    // Make sure nothing has happened yet
    expect(recieved.length).toEqual(0)

    await lf.useCapability(postCap)

    expect(recieved.length).toEqual(1)
    const m1 = recieved[0]
    expect(m1.actor).toEqual(actor)
    expect(m1.target).toEqual(target)
    expect(m1.deleted).toBeFalsy()
    const targetHash = m1.targetHash
    const salt = m1.salt

    const delCap = await lf.createDeleteCapability(targetHash, salt, actor)
    expect(recieved.length).toEqual(1)

    await lf.useCapability(delCap)

    expect(recieved.length).toEqual(2)
    const m2 = recieved[1]
    expect(m2.actor).toEqual(actor)
    expect(m2.target).toBeUndefined()
    expect(m2.salt).toEqual(salt)
    expect(m2.targetHash).toEqual(targetHash)
    expect(m2.deleted).toBeTruthy()
  })

  it('local add before listener', async ()=> {
    const { actor, actorClient } = actorClientMock()
    const lf = new (linksFrom(actorClient))("something cool!")

    const target = 12345
    const postCap = await lf.createPostCapability(target, actor)
    await lf.useCapability(postCap)

    const recieved = []
    lf.addListener((m)=> {
      recieved.push(m)
    })

    expect(recieved.length).toEqual(1)
    const m = recieved[0]
    expect(m.actor).toEqual(actor)
    expect(m.target).toEqual(target)
    expect(m.deleted).toEqual(false)
  })

  it('local delete before listener', async ()=> {
    const { actor, actorClient } = actorClientMock()
    const lf = new (linksFrom(actorClient))("something cool!")

    const target = 12345
    const postCap = await lf.createPostCapability(target, actor)
    await lf.useCapability(postCap)

    let salt, targetHash
    lf.addListener(m=> {
      salt = m.salt
      targetHash = m.targetHash
    })

    expect(salt).toBeDefined()
    expect(targetHash).toBeDefined()

    const deleteCap = await lf.createDeleteCapability(targetHash, salt, actor)
    await lf.useCapability(deleteCap)

    let count = 0
    lf.addListener(m=> count++)
    expect(count).toEqual(0)
  })

  it('multiple callbacks', async ()=> {
    const { actor, actorClient } = actorClientMock()
    const lf = new (linksFrom(actorClient))("something cool!")

    const recieved1 = []
    const recieved2 = []

    lf.addListener(m=> {
      recieved1.push(m)
    })

    const target = { what: 'else' }
    const postCap = await lf.createPostCapability(target, actor)
    await lf.useCapability(postCap)

    lf.addListener((m)=> {
      recieved2.push(m)
    })

    expect(recieved1.length).toEqual(1)
    expect(recieved2.length).toEqual(1)
    const m1 = recieved1[0]
    const m2 = recieved2[0]
    expect(m1.actor).toEqual(m2.actor)
    expect(m1.target).toEqual(m2.target)
    expect(m1.deleted).toEqual(m2.deleted)
  })

  it('delete callbacks', async ()=> {
    const { actor, actorClient } = actorClientMock()
    const lf = new (linksFrom(actorClient))("something cool!")

    const recieved = []
    const callback = m=> recieved.push(m)
    lf.addListener(callback)
    expect(recieved.length).toEqual(0)

    const target1 = '🤷‍♀️'
    const postCap1 = await lf.createPostCapability(target1, actor)
    await lf.useCapability(postCap1)

    expect(recieved.length).toEqual(1)

    const target2 = '🤷'
    const postCap2 = await lf.createPostCapability(target2, actor)
    await lf.useCapability(postCap2)

    expect(recieved.length).toEqual(2)

    lf.removeListener(callback)

    const target3 = '😮‍💨'
    const postCap3 = await lf.createPostCapability(target3, actor)
    await lf.useCapability(postCap3)

    expect(recieved.length).toEqual(2)
  })

  it('add and delete one peer to another', async ()=> {
    const { actor: actor1, actorClient: actorClient1 } = actorClientMock()
    const lf1 = new (linksFrom(actorClient1))("something cool!")
    const { actor: actor2, actorClient: actorClient2 } = actorClientMock()
    const lf2 = new (linksFrom(actorClient2))("something cool!")

    addSendGossip(lf1, lf2)

    const target = 'hello world'
    const postCap = await lf1.createPostCapability(target, actor1)

    const got = [0,0]
    let salt, targetHash
    const checkMessage = index => {
      return m=> {
        expect(m.actor).toEqual(actor1)
        if (!got[index]) {
          expect(m.target).toEqual(target)
          expect(m.deleted).toEqual(false)
          salt = m.salt
          targetHash = m.targetHash
        } else {
          expect(m.target).toBeUndefined()
          expect(m.targetHash).toEqual(targetHash)
          expect(m.deleted).toEqual(true)
          expect(m.salt).toEqual(salt)
        }
        got[index]++
      }
    }

    lf1.addListener(checkMessage(0))

    await lf1.useCapability(postCap)

    lf2.addListener(checkMessage(1))

    expect(got[0]).toEqual(1)
    expect(got[1]).toEqual(1)

    // Now delete the message
    const delCap = await lf1.createDeleteCapability(targetHash, salt, actor1)
    await lf2.useCapability(delCap)

    expect(got[0]).toEqual(2)
    expect(got[1]).toEqual(2)
  })

  it('non-matching sources', async ()=> {
    const { actor: actor1, actorClient: actorClient1 } = actorClientMock()
    const lf1 = new (linksFrom(actorClient1))("my source")
    const { actor: actor2, actorClient: actorClient2 } = actorClientMock()
    const lf2 = new (linksFrom(actorClient2))("your source")
    addSendGossip(lf1, lf2)

    const postCap = await lf1.createPostCapability('hi', actor1)
    await lf1.useCapability(postCap)

    let count1 = 0
    let count2 = 0
    lf1.addListener(m=> count1++)
    lf2.addListener(m=> count2++)

    expect(count1).toEqual(1)
    expect(count2).toEqual(0)

    await expect(lf2.useCapability(postCap)).rejects.toThrowError()
  })

  it('onAnnounce', async ()=> {
    const { actor: actor1, actorClient: actorClient1 } = actorClientMock()
    const lf1 = new (linksFrom(actorClient1))("same source")
    const { actor: actor2, actorClient: actorClient2 } = actorClientMock()
    const lf2 = new (linksFrom(actorClient2))("same source")
    lf1.send = (peer, message) => peer.onMessage(lf1, message)
    lf2.send = (peer, message) => peer.onMessage(lf2, message)

    const postCap = await lf1.createPostCapability('hi', actor1)
    await lf1.useCapability(postCap)

    let count1 = 0
    let count2 = 0
    lf1.addListener(m=>count1++)
    lf2.addListener(m=>count2++)

    expect(count1).toEqual(1)
    expect(count2).toEqual(0)

    await lf1.onAnnounce(lf2)

    expect(count1).toEqual(1)
    expect(count2).toEqual(1)
  })
})