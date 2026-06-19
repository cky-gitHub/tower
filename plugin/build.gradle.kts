plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.intellij") version "1.17.2"
}

group = property("pluginGroup") as String
version = property("pluginVersion") as String

repositories {
    mavenCentral()
}

// Read IntelliJ platform properties
val intellijVersion: String by project
val intellijType: String by project
val kotlinVersion: String by project
val jvmTarget: String by project

intellij {
    version.set(intellijVersion)
    type.set(intellijType)
    downloadSources.set((property("intellijDownloadSources") as String).toBoolean())
    
    plugins.set(listOf())
}

// Use bundled JetBrains Runtime for sandbox to avoid Microsoft JDK issues
tasks.runIde {
    jbrVersion.set("17.0.9b1007.1")
}

// Disable instrumentation temporarily to work around Microsoft JDK issue
tasks.instrumentCode {
    enabled = false
}

tasks {
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        kotlinOptions.jvmTarget = jvmTarget
    }

    patchPluginXml {
        sinceBuild.set("233")
        untilBuild.set("241.*")
    }

    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }
}

// Webview build task - runs npm build and copies dist to plugin resources
val buildWebview by tasks.registering {
    group = "webview"
    description = "Build the React webview and copy to plugin resources"
    
    val webviewDir = project.projectDir.parentFile.resolve("webview")
    val distDir = webviewDir.resolve("dist")
    val resourcesDir = project.projectDir.resolve("src/main/resources/webview")
    
    inputs.dir(webviewDir.resolve("src"))
    inputs.file(webviewDir.resolve("package.json"))
    inputs.file(webviewDir.resolve("vite.config.ts"))
    outputs.dir(resourcesDir)
    
    doLast {
        // Run npm build
        exec {
            workingDir = webviewDir
            commandLine("npm.cmd", "run", "build")
        }
        
        // Copy dist to resources
        delete(resourcesDir)
        copy {
            from(distDir)
            into(resourcesDir)
        }
    }
}

tasks.named("processResources") {
    dependsOn(buildWebview)
}
