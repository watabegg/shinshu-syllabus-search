"""Local OCR fallback for PDFs without embedded text."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def ocr_pdf(pdf_path: Path, timeout: int = 120) -> list[str]:
    env = os.environ.copy()
    executable = env.get("TESSERACT") or shutil.which("tesseract")
    local = Path(__file__).resolve().parents[2] / "data/tools/ocr/root/usr"
    if not executable and (local / "bin/tesseract").exists():
        executable = str(local / "bin/tesseract")
        env["LD_LIBRARY_PATH"] = str(local / "lib/x86_64-linux-gnu") + (
            ":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        env.setdefault("TESSDATA_PREFIX", str(local / "share/tesseract-ocr/5/tessdata"))
    if not executable:
        raise RuntimeError("image PDF requires Tesseract with jpn and eng language data")
    with tempfile.TemporaryDirectory(prefix="syllabus-ocr-") as directory:
        prefix = Path(directory) / "page"
        subprocess.run(["pdftoppm", "-scale-to", "3500", "-png", str(pdf_path), str(prefix)],
                       check=True, capture_output=True, timeout=timeout)
        pages = []
        for path in sorted(Path(directory).glob("page-*.png")):
            result = subprocess.run([executable, str(path), "stdout", "-l", "jpn+eng",
                                     "--psm", "3", "-c", "preserve_interword_spaces=1"],
                                    check=True, capture_output=True, timeout=timeout, env=env)
            pages.append(result.stdout.decode("utf-8"))
        if not pages or not any(page.strip() for page in pages):
            raise RuntimeError("OCR returned no text")
        # Keep the uncorrected OCR output beside the original PDF for auditing.
        pdf_path.with_suffix(".ocr.txt").write_text("\f".join(pages), encoding="utf-8")
        return pages
