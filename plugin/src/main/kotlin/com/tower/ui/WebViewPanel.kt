package com.tower.ui

import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import javax.swing.JPanel

class WebViewPanel : JPanel(BorderLayout()) {
    private val browser = JBCefBrowser()
    private val bridge = JBCefBridge(browser)

    init {
        bridge.handle("ping") { "pong" }
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(browser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (frame.isMain) {
                    browser.executeJavaScript(bridge.injectFunction(), frame.url, 0)
                }
            }
        }, browser.cefBrowser)
        add(browser.component, BorderLayout.CENTER)
        val webviewDir = extractWebview()
        browser.loadHTML(createInlineHtml(webviewDir), webviewDir.resolve("index.html").toUri().toString())
    }

    private fun createInlineHtml(webviewDir: Path): String {
        val html = Files.readString(webviewDir.resolve("index.html"))
        val assetsDir = webviewDir.resolve("assets")
        val css = Files.list(assetsDir).use { paths ->
            paths.filter { it.fileName.toString().endsWith(".css") }
                .findFirst()
                .map { Files.readString(it) }
                .orElse("")
        }
        val js = Files.list(assetsDir).use { paths ->
            paths.filter { it.fileName.toString().endsWith(".js") }
                .findFirst()
                .map { Files.readString(it) }
                .orElse("")
        }

        return html
            .replace(Regex("<link[^>]+href=\"\\./assets/[^\"]+\\.css\"[^>]*>"), "<style>$css</style>")
            .replace(Regex("<script[^>]+src=\"\\./assets/[^\"]+\\.js\"[^>]*></script>"), "<script>$js</script>")
    }

    private fun extractWebview(): Path {
        val targetDir = Files.createTempDirectory("tower-webview")
        copyResourceDirectory("webview", targetDir)
        return targetDir
    }

    private fun copyResourceDirectory(resourcePath: String, targetDir: Path) {
        val classLoader = javaClass.classLoader
        val resourceUrl = classLoader.getResource(resourcePath)
            ?: error("Missing bundled webview resources")

        when (resourceUrl.protocol) {
            "file" -> {
                val sourcePath = Path.of(URLDecoder.decode(resourceUrl.path, StandardCharsets.UTF_8))
                Files.walk(sourcePath).use { paths ->
                    paths.forEach { source ->
                        val target = targetDir.resolve(sourcePath.relativize(source).toString())
                        if (Files.isDirectory(source)) {
                            Files.createDirectories(target)
                        } else {
                            Files.createDirectories(target.parent)
                            Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING)
                        }
                    }
                }
            }

            "jar" -> {
                val connection = resourceUrl.openConnection() as java.net.JarURLConnection
                val jarFile = connection.jarFile
                val prefix = connection.entryName.trimEnd('/') + "/"
                jarFile.entries().asSequence()
                    .filter { it.name.startsWith(prefix) && !it.isDirectory }
                    .forEach { entry ->
                        val relativePath = entry.name.removePrefix(prefix)
                        val target = targetDir.resolve(relativePath)
                        Files.createDirectories(target.parent)
                        jarFile.getInputStream(entry).use { input ->
                            Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING)
                        }
                    }
            }

            else -> error("Unsupported webview resource protocol: ${resourceUrl.protocol}")
        }
    }
}
