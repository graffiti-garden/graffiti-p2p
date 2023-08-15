import P2PWrapper from "./src/p2p-wrapper"
import ActorClient from '@graffiti-garden/actor-client'
import GraffitiObject from './src/object'
import GraffitiContext from './src/context'
import { randomHash } from "./src/util"
import { createStore, entries, del } from "idb-keyval"

  ///////
// - tracker client and peerjs reconnect
// - optimization
//   - only send stuff (esp. big stuff like images) if other person *doesn't* have it
//   - don't block when sending stuff to peers
  ///////

export default class Graffiti {
  constructor(options) {
    this.actorClient = new ActorClient(options.actorManager)
    this.wrapper = new P2PWrapper(this.actorClient, options)
    this.objectContainer = options.objectContainer

    const objectStore = createStore('graffiti', 'objects')
    entries(objectStore).then(existingObjects=> {
      for (const [id, {actor, path, signed}] of existingObjects) {
        try {
          const object = this.wrapper.get(GraffitiObject, actor, path, this.objectContainer)
          object.onMessage(null, signed)
        } catch {
          del(id, objectStore)
        }
      }
    })
  }

  async selectActor() {
    return await this.actorClient.selectActor()
  }

  async post(value, actor) {
    const object = this.wrapper.get(GraffitiObject, actor, await randomHash(), this.objectContainer)
    return await object.apply(o=>Object.assign(o,value)).post()
  }

  async edit(post, func) {
    const object = this.wrapper.get(GraffitiObject, post.actor, post.path, this.objectContainer)
    return await object.apply(func).post()
  }

  async delete(post) {
    const object = this.wrapper.get(GraffitiObject, post.actor, post.path, this.objectContainer)
    await object.delete()
  }

  async * posts(contextPath, signal) {
    const context = this.wrapper.get(
      GraffitiContext,
      contextPath,
      this.objectContainer)
    yield * context.posts(signal)
  }
}
