import * as jose from 'jose'
import { sha256Hex, sha256Uint8, encoder, decoder } from "./util"

async function encrypt(value, password) {
  return new jose.CompactEncrypt(encoder.encode(value))
      .setProtectedHeader({
        alg: 'dir',
        enc: 'A128CBC-HS256',
      }).encrypt(await sha256Uint8('key:'+password))
}

async function decrypt(encrypted, password) {
  const { plaintext } =
    await jose.compactDecrypt(encrypted, await sha256Uint8('key:'+password))
  return decoder.decode(plaintext)
}

export default class GraffitiObject {

  static toURI(actor, path) {
    if(typeof actor === "undefined")
      throw "Actor is not defined"
    return `object:${actor}:${path}`
  }

  constructor(actorClient, wrapper, actor, path, container) {
    this.actor = actor
    this.path = path
    this.actorClient = actorClient

    this._value = container? container() : {}
    Object.defineProperty(this._value, 'id', {value: this.constructor.toURI(actor, path)})
    Object.defineProperty(this._value, 'actor', {value: actor})
    Object.defineProperty(this._value, 'path', {value: path})

    this.peers = new Set() 
    this.functionsToApply = new Set()
    this.unsigned = {}
    this.signed = null
  }

  apply(func) {
    this.functionsToApply.add(func)
    return this
  }

  async delete() {
    await this
    // Remove all properties
    .apply(v=>Object.keys(v).forEach(k=> delete v[k]))
    // And post
    .post()
  }

  async post() {
    // Apply the functions
    const existing = Object.assign({}, this._value)
    this.functionsToApply.forEach(func=>func(this._value))
    this.functionsToApply.clear()

    let unsigned, signed
    try {
      // Make sure the context is still
      // an array of string if it exists
      if (this._value.context) {
        if (!(this._value.context instanceof Array)) {
          throw "value.context must be an array"
        }
        this._value.context.forEach(c=> {
          if (!(c instanceof String)) {
            throw `context ${c} is not a string`
          }
        })
      }

      unsigned = {
        updated: Date.now(),
        hashPath: await sha256Hex(this.path),
        // Encrypt the list of contexts and the value by the context
        encryptedValue: await encrypt(JSON.stringify(this._value), this.path),
        encryptedContexts:
          Object.assign({},
            ...await Promise.all(
              Object.keys(this._value.context ?? {}).map(async context=> ({
                [await sha256Hex(context)]: encrypt(this.path, context)
              }))
            )
          )
      }

      signed = await this.actorClient.sign(unsigned, this.actor)
    } catch(e) {
      // Restore the original object without
      // without destroying reference
      for (const prop in this._value) {
        if (!(prop in existing))
          delete this._value[prop]
      }
      Object.assign(this._value, existing)
      throw e
    }

    await this.#store(unsigned, signed)
  }

  async onMessage(peer, signed) {
    await this.onAnnounce(peer)

    // Verify the JWT and the signature
    const { payload: unsigned, actor } = await this.actorClient.verify(signed)

    if (unsigned.updated <= this.unsigned.updated ?? 0) return
    if (actor != this.actor ) return
    if (unsigned.hashPath != await sha256Hex(this.path)) return

    let value
    try {
      const decrypted = await decrypt(unsigned.encryptedValue, this.path)
      value = JSON.parse(decrypted)
    } catch {
      return
    }
    if (!(value instanceof Object)) return
    if (value.context) {
      if (!(value.context instanceof Array)) return
      if (value.context.some(c=> !(c instanceof String))) return
    }

    // Don't destroy the object reference
    for (const prop in this._value) {
      if (!(prop in value))
        delete this._value[prop]
    }
    Object.assign(this._value, value)

    this.#store(unsigned, signed)
  }

  async onAnnounce(peer) {
    if (!this.peers.has(peer)) {
      this.peers.add(peer)
      if (this.signed) {
        await this.send(peer, this.signed)
      }
    }
  }

  onUnannounce(peer) {
    this.peers.delete(peer)
  }

  async #store(unsigned, signed) {
    this.unsigned = unsigned
    this.signed = signed
    await this.gossip([...this.peers], signed)

    // Also share it with context (by gossiping directly)
    // Including deleted ones??
    // for (context of contexts) {
    //   get(context).onMessage(null, signed)
    // }
  }

  objectHandler() {
    return {
      get: (target, prop, receiver)=> {
        // Make sure handling is recursive
        const got = Reflect.get(target, prop, receiver)
        return (typeof got === 'object' && got !== null)?
          new Proxy(got, this.objectHandler()) : got
      },
      set: (target, prop, val, receiver)=> {
        this.apply(()=> Reflect.set(target, prop, val, receiver)).post()
        return true
      }, 
      deleteProperty: (target, prop)=> {
        this.apply(()=> Reflect.deleteProperty(target, prop)).post()
        return true
      }
    }
  }

  get value() {
    return new Proxy(this._value, this.objectHandler())
  }
}