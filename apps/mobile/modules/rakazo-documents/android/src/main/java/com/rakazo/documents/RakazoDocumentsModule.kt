package com.rakazo.documents

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.min

class RakazoDocumentsModule : Module() {
  private fun cachedFile(uri: String): File {
    val context = appContext.reactContext ?: throw IllegalStateException("App not ready")
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Expected a cached file" }
    val file = File(parsed.path ?: "").canonicalFile
    require(file.path.startsWith(context.cacheDir.canonicalPath + File.separator)) { "Expected a cached file" }
    return file
  }
  override fun definition() = ModuleDefinition {
    Name("RakazoDocuments")
    AsyncFunction("pdfPage") { uri: String, pageIndex: Int ->
      ParcelFileDescriptor.open(cachedFile(uri), ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
          require(pageIndex >= 0 && pageIndex < renderer.pageCount) { "Page out of range" }
          renderer.openPage(pageIndex).use { page ->
            val scale = min(1400.0 / page.width, 1800.0 / page.height)
            val bitmap = Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
            try {
              bitmap.eraseColor(Color.WHITE)
              page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
              val bytes = ByteArrayOutputStream()
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
              mapOf("count" to renderer.pageCount, "width" to bitmap.width, "height" to bitmap.height, "image" to "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
            } finally { bitmap.recycle() }
          }
        }
      }
    }
  }
}
