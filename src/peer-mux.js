import Peer from 'peerjs'
import { sha256Hex } from './util'
import { encrypt, decrypt } from './crypto'

/**
 * A wrapper around peerJS so that peers
 * can talk about multiple topics over the
 * same webRTC connection.
 * 
 * Communication over those topics is encrypted.
 * 
 * const pm = new PeerMux(myPeerID)
 * const wire = await pm.createWire(topicURI, onMessage)
 * await wire.send(peer, message)
 * await wire.gossip(peers, message, fanout)
 */
export default class PeerMux {

  constructor(peerID, peerjsOptions) {
    this.peer = new Peer(peerID, peerjsOptions?? {
      host: "peerjs.graffiti.garden",
      secure: true
    })

    this.connections = {} // peerID-> connection
    this.wires = {} // infoHash-> {key, onMessage}

    this.open = false
    this.peer.on('open', ()=> this.open = true)

    this.errorEvents = new EventTarget()
    this.peer.on('error', e=>{
      const match = e.toString().match(/^Error: Could not connect to peer ([a-z0-9]{64})/)
      if (match && match.length >= 2) {
        const peer = match[1]
        const errorEvent = new Event(peer)
        errorEvent.error = e
        this.errorEvents.dispatchEvent(errorEvent)
        delete this.connections[peer]
      } else {
        console.error(`Peer Error: ${e}`)
      }
    })

    this.peer.on('connection', this.#onConnection.bind(this))
  }

  async isOpen() {
    if (this.open) return

    await new Promise(resolve => 
      this.peer.on('open', ()=> resolve()))
  }

  destroy() {
    this.peer.destroy()
  }

  #onConnection(connection) {
    this.connections[connection.peer] = connection
    connection.on('close', ()=> delete this.connections[connection.peer])
    connection.on('error', e=> {
      console.error("connection error")
      console.error(e)
    })
    connection.on('data', this.#onMessage.bind(this, connection.peer))
  }

  async #onMessage(peer, message) {
    const { infoHash, encrypted } = message
    if (!(infoHash in this.wires)) return

    const decrypted = await decrypt(encrypted, infoHash)

    // Forward to the appropriate wire
    this.wires[infoHash]?.onMessage(peer, JSON.parse(decrypted))
  }

  async createWire(uri, onMessage) {
    await this.isOpen()

    const infoHash = await sha256Hex(uri)
    if (infoHash in this.wires)
      throw "A wire with that uri already exists"

    this.wires[infoHash] = { onMessage }

    const send = async (peer, message)=> {

      // If sending to self, skip encryption
      if (peer == this.peer.id)
        return this.wires[infoHash]?.onMessage(peer, message)

      const encrypted = await encrypt(JSON.stringify(message), infoHash)

      // Connect to the peer
      if (!(peer in this.connections)) {
        this.#onConnection(this.peer.connect(peer))
      }
      const connection = this.connections[peer]

      // Wait for it to open or error
      if (!connection.open) {
        await Promise.race([
          new Promise(resolve => 
            connection.on('open', ()=>resolve())),
          new Promise((resolve, reject)=> 
            this.errorEvents.addEventListener(
              peer,
              e=> reject(e.error),
              { once: true, passive: true }))])
      }

      // And send it to the relevant peer
      connection.send({
        encrypted,
        infoHash
      })
    }

    const gossip = async (peers, message, fanout=5)=> {
      return await Promise.allSettled(
        peers
          // Shuffle the peers
          .sort(()=> 0.5 - Math.random())
          // Sample N from the shuffle
          .slice(0, fanout)
          // Map to send
          .map(peer=> send(peer, message)))
    }

    const destroy = ()=> {
      delete this.wires[infoHash]
    }

    return { send, gossip, destroy }
  }
}