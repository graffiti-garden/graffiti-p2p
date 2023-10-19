import Ajv2020 from "ajv/dist/2020"
import { sha256Hex } from "./util"
import * as stringify from 'fast-json-stable-stringify'

const ajv = new Ajv2020()
export const messageSchemaValidate = ajv.compile({
  type: "object",
  unevaluatedProperties: false,
  required: ["intent"],
  oneOf: [{
    properties: {
      intent: { enum: ["have", "want"] },
      links: {
        type: "object",
        patternProperties: {
          // actor + targetHash + salt
          ".*":
          // is not deleted?
          { type: "boolean" }
        },
        minProperties: 1,
        additionalProperties: false
      },
    },
    required: ["links"]
  }, {
    properties: {
      intent: { const: "give" },
      signature: { type: "string"},
      target: {},
    },
    required: ["intent", "signature"]
  }]
})

export const signaturePayloadValidate = ajv.compile({
  type: "object",
  properties: {
    source: {},
    targetHash: { type: "string" },
    salt: { type: "string" },
    deleted: { type: "boolean" }
  },
  required: ['source', 'targetHash', 'salt', 'deleted'],
  additionalProperties: false
})

export default async function routeMessage(message, onHave, onWant, onGive, actorClient) {
  if (!messageSchemaValidate(message)) {
    throw messageSchemaValidate.errors
  }

  if (message.intent == 'have') {
    await onHave(message.links)
  } else if (message.intent == 'want') {
    await onWant(message.links)
  } else if (message.intent == 'give') {
    const { signature, target } = message

    const { payload, actor } = await actorClient.verify(signature)

    if (!signaturePayloadValidate(payload)) {
      throw signaturePayloadValidate.errors
    }

    const { source, targetHash, salt, deleted } = payload

    if (deleted) {
      if (target != undefined) {
        throw "Cannot include target in a deletion"
      }
    } else {
      if (targetHash != await sha256Hex(stringify(target))) {
        throw "Signed hash of target does not match the hash of target"
      }
    }

    await onGive({
      source,
      target,
      targetHash,
      salt,
      actor,
      deleted,
      signature
    })
  }
}