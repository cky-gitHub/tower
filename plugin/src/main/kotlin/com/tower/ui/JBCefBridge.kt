package com.tower.ui

import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery

class JBCefBridge(private val browser: JBCefBrowser) {
    private val handlers = mutableMapOf<String, (String) -> String>()
    private val query = JBCefJSQuery.create(browser)

    init {
        query.addHandler { request ->
            val separatorIndex = request.indexOf(':')
            if (separatorIndex == -1) {
                return@addHandler JBCefJSQuery.Response("", 400, "Invalid bridge request")
            }

            val name = request.substring(0, separatorIndex)
            val payload = request.substring(separatorIndex + 1)
            val handler = handlers[name]
                ?: return@addHandler JBCefJSQuery.Response("", 404, "No bridge handler registered for $name")

            try {
                JBCefJSQuery.Response(handler(payload))
            } catch (error: Throwable) {
                JBCefJSQuery.Response("", 500, error.message ?: "Bridge handler failed")
            }
        }

        Disposer.register(browser.jbCefClient, query)
    }

    fun handle(name: String, handler: (String) -> String) {
        handlers[name] = handler
    }

    fun injectFunction(): String {
        return """
            window.towerBridge = {
              call: function(name, payload) {
                return new Promise(function(resolve, reject) {
                  ${query.inject("name + ':' + JSON.stringify(payload ?? null)", "resolve", "reject")}
                });
              }
            };
        """.trimIndent()
    }
}
