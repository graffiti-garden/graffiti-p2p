import P2PWrapper from "./src/p2p-wrapper"
import ActorClient from '@graffiti-garden/actor-client'
import GraffitiObject from './src/object'
import GraffitiContext from './src/context'
import { randomHash } from "./src/util"
import { createStore, values } from "idb-keyval"


  ///////
// - do it on another domain
// - localhost testing of actors
// - tracker client and peerjs reconnect
// - mirror -> do it with the server??? (fix issues with peer stuff???)
// - Private messaging
  ///////

// - clean up authentication UI
// - make an actual demo
// - optimization

export default class Graffiti {
  constructor(options) {
    this.actorClient = new ActorClient(options.actorManager)
    this.wrapper = new P2PWrapper(this.actorClient, options)
    this.objectContainer = options.objectContainer

    setTimeout(async ()=> { // TODO: fix this hack
      const objectStore = createStore('graffiti', 'objects')
      values(objectStore).then(existingObjects=> {
        for (const {actor, path, signed} of existingObjects) {
          const object = this.wrapper.get(GraffitiObject, actor, path, this.objectContainer)
          object.onMessage(null, signed)
        }
      })
    }, 1000)
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

  context(path) {
    return this.wrapper.get(GraffitiContext, path, this.objectContainer)
  }
}