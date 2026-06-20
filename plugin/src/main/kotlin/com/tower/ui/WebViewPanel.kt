package com.tower.ui

import com.intellij.ui.jcef.JBCefBrowser
import java.awt.BorderLayout
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import javax.swing.JPanel

class WebViewPanel : JPanel(BorderLayout()) {
    private val browser = JBCefBrowser()

    init {
        add(browser.component, BorderLayout.CENTER)
        browser.loadURL(extractWebview().resolve("index.html").toUri().toString())
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
