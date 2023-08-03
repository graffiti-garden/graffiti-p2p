import Graffiti from '../graffiti-p2p.js'

const REFRESH_RATE = 100 // milliseconds

export default function GraffitiPlugin(Vue) {
  return {
    install(app, options) {
      const graffiti = new Graffiti({
        ...options,
        objectContainer: ()=> Vue.reactive({})
      })

      // A composable that returns a collection of objects
      graffiti.usePosts = contextPath=> {
        const postMap = Vue.reactive({})

        // Run the loop in the background
        let running = true
        let controller
        let timeoutID = null
        ;(async ()=> {

          while (running) {
            controller = new AbortController();
            const signal = controller.signal;

            const unwatch =
              Vue.isRef(contextPath)?
                Vue.watch(contextPath, ()=> {
                  // Clear the object map and restart the loop
                  Object.keys(postMap).forEach(k=> delete postMap[k])
                  controller.abort()
                  unwatch()
                  clearTimeout(timeoutID)
                  timeoutID = null
                }) : ()=>{}

            // Unwrap more and stream changes into batches
            const batch = {}
            const context = graffiti.context(Vue.isRef(contextPath)? contextPath.value : contextPath)
            try {
              for await (const postUpdate of context.posts(signal)) {
                batch[postUpdate.hashURI] = postUpdate

                // Flush the batch after timeout
                if (!timeoutID) {
                  timeoutID = setTimeout(()=> {
                    for (const update of Object.values(batch)) {
                      if (update.action == "add") {
                        postMap[update.hashURI] = update.value
                      } else {
                        if (update.hashURI in postMap)
                          delete postMap[update.hashURI]
                      }
                    }
                    timeoutID = null
                  }, REFRESH_RATE)
                }
              }
            } catch (e) {
              if (e.code != DOMException.ABORT_ERR) {
                throw e
              }
            }
          }
        })()

        Vue.onScopeDispose(()=> {
          // Stop the loop
          running = false
          controller.abort()
          unwatch()
          clearTimeout(timeoutID)
        })

        // Strip IDs
        return { posts: Vue.computed(()=> Object.values(postMap)) }
      }

      // Begin to define a global property that mirrors
      // the vanilla spec but with some reactive props
      const glob = app.config.globalProperties
      Object.defineProperty(glob, "$graffiti", { value: graffiti })
      Object.defineProperty(glob, "$gf",       { value: graffiti })

      // Provide it globally to setup
      app.provide('graffiti', graffiti)
    }
  }
}