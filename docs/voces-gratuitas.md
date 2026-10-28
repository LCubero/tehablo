# Voces gratuitas en español para clonar con Pocket TTS

Catálogo de fuentes de audio gratuitas que se pueden descargar y usar como **voz de referencia** (10 a 30 s limpios) en Pocket TTS u otros modelos con clonación.

**Fecha de la búsqueda:** 29/10/2026. Se consultaron Hugging Face (API y buscador), GitHub, OpenSLR, Mozilla Data Collective, Kaggle y Reddit (r/TextToSpeech).

**Cómo leer las etiquetas:**
- **VERIFICADO**: comprobado en la página oficial o en la API del dataset.
- **SEGÚN LA FICHA**: lo que declara el autor, sin comprobar más a fondo.
- **SIN VERIFICAR**: no se pudo confirmar.

Las licencias y los estados cambian: vuelve a comprobarlos antes de publicar nada.

> ⚠️ **Consentimiento:** las condiciones de Pocket TTS prohíben *"voice impersonation or cloning without explicit and lawful consent"*. Usa solo datasets publicados para TTS o voz, tu propia voz o la de alguien que te dé su permiso. No clones voces de famosos, de asistentes comerciales (Cortana, Siri…), de vídeos de YouTube o TikTok ni de servicios de pago.

## Índice

1. [Recomendación rápida](#1-recomendación-rápida)
2. [Ya descargadas en el proyecto](#2-ya-descargadas-en-el-proyecto)
3. [Fuentes recomendadas (licencia libre y buena calidad)](#3-fuentes-recomendadas)
4. [Fuentes útiles con limitaciones](#4-fuentes-útiles-con-limitaciones)
5. [Fuentes que conviene evitar](#5-fuentes-que-conviene-evitar)
6. [Colecciones listas para clonar (no españolas)](#6-colecciones-listas-para-clonar-no-españolas)
7. [Cómo ampliar `scripts/get_voices.py`](#7-cómo-ampliar-scriptsget_voicespy)
8. [Cómo preparar una buena referencia](#8-cómo-preparar-una-buena-referencia)
9. [Fuentes consultadas](#9-fuentes-consultadas)

---

## 1. Recomendación rápida

| Si quieres… | Usa | Licencia |
|---|---|---|
| Acentos latinoamericanos variados (ar, cl, co, **pe, pr, ve**) sin bajar gigas | `GianDiego/latam-spanish-speech-orpheus-tts-24khz` (a través de la API de filas) | CC BY-SA 4.0 |
| Una voz masculina de España, limpia y **sin condiciones** | **Dave** (Nabu Casa / Open Home Foundation) | **CC0** |
| Una voz masculina mexicana | **Ald** (`rmcpantoja/Ald_Mexican_Spanish_speech_dataset`) | Unlicense (dominio público) |
| Muchas voces argentinas | `Kukedlc/arg-spanish-tts` (65 hablantes) | CC BY 4.0, según la ficha |
| Miles de voces de cualquier país | Mozilla Common Voice (es) | CC0, calidad variable |
| Uso comercial **sin atribución** | Solo las CC0 o dominio público: Dave, Ald, Common Voice, LibriVox | — |

---

## 2. Ya descargadas en el proyecto

`scripts/get_voices.py` descargó **18 voces** en `voices/`, procedentes de los corpus de Google OpenSLR 61, 71 y 72 a través de las copias `ylacombe/google-*-spanish`:

| País | Mujer | Hombre | Licencia |
|---|---|---|---|
| Argentina | 3 | 3 | CC BY-SA 4.0 |
| Chile | 3 | 3 | CC BY-SA 4.0 |
| Colombia | 3 | 3 | CC BY-SA 4.0 |

Necesitan los pesos con clonación (token de Hugging Face; ver [README](../README.md)).

---

## 3. Fuentes recomendadas

| Fuente | Acento | Hablantes | Tamaño | Licencia | Estado | Cómo conseguirla |
|---|---|---|---|---|---|---|
| [GianDiego/latam-spanish-speech-orpheus-tts-24khz](https://huggingface.co/datasets/GianDiego/latam-spanish-speech-orpheus-tts-24khz) | ar, cl, co, **pe, pr, ve** | Varios por país, mujer y hombre | 24.437 frases, 3,7 GB, **24 kHz** (la frecuencia que usa Pocket TTS) | CC BY-SA 4.0 (deriva de OpenSLR) | **VERIFICADO** con la API: columnas `nationality`, `gender`, `speaker_id`; filas por país: pe 5.447, ar 5.739, co 4.903, cl 4.374, ve 3.357, pr 617 | API de filas de Hugging Face, igual que `scripts/get_voices.py`; filtrando por `nationality` y `gender` |
| [Dave (es_ES)](https://github.com/OHF-Voice/voice-datasets), de Nabu Casa / Open Home Foundation | España | 1 hombre | ~1,5 h, unos 85 MB | **CC0** | **VERIFICADO** en el README del repositorio y en [Mozilla Data Collective](https://mozilladatacollective.com/datasets/cmid4ir9100bgnu07du03svuc) | ZIP directo: `https://github.com/OHF-Voice/voice-datasets/releases/download/v1.0.0/es_ES-dave.zip` |
| [Ald Mexican Spanish](https://huggingface.co/datasets/rmcpantoja/Ald_Mexican_Spanish_speech_dataset) | México | 1 hombre (Aldo) | 535 audios, 1 h 33 min | **Unlicense** | **SEGÚN LA FICHA**; es la base de la voz Piper `es_MX-ald` | Hugging Face |
| [Kukedlc/arg-spanish-tts](https://huggingface.co/datasets/Kukedlc/arg-spanish-tts) | Argentina | 65 | 10.747 frases, 12,2 h, 24 kHz | CC BY 4.0 en la ficha | **SEGÚN LA FICHA**. Junta tres datasets públicos: hay que comprobar que la licencia de los originales sea compatible, porque si incluye OpenSLR 61 su licencia real sería CC BY-SA | Hugging Face / API de filas |
| Google LATAM en OpenSLR: [61](https://www.openslr.org/61/) ar, [71](https://www.openslr.org/71/) cl, [72](https://www.openslr.org/72/) co, [73](https://www.openslr.org/73/) pe, [74](https://www.openslr.org/74/) pr, [75](https://www.openslr.org/75/) ve | 6 países | Decenas | ZIP por país y género: pe 914 MB y 1,03 GB, pr (solo mujer) 214 MB, ve 517 y 526 MB, ar mujer 1,26 GB | CC BY-SA 4.0 | **VERIFICADO** (tamaños con `HEAD`) | Mejor a través de la copia de GianDiego (sin ZIP) |
| [Mozilla Common Voice (es)](https://mozilladatacollective.com/datasets/cmu5kitx700pemi073feoiqqu), versión 27.0 | Muchos países | Miles | **48 GB** | **CC0** | **VERIFICADO** en Mozilla Data Collective | Registro en Mozilla Data Collective. Alternativa: copias en Hugging Face como [bookbot/common_voice_23_0_es](https://huggingface.co/datasets/bookbot/common_voice_23_0_es) (CC0, v23) |
| LibriVox en español | Muchos (narradores) | Decenas | Variable | **Dominio público** | **VERIFICADO** como norma general de LibriVox | Elegir un narrador en [librivox.org](https://librivox.org) y recortar 10 a 30 s. Hay un ejemplo de este método en [gabriele-mastrapasqua/qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/main/samples/voice_clone_refs/ATTRIBUTION.md) (clips de 30 s a partir del segundo 30) |

---

## 4. Fuentes útiles con limitaciones

| Fuente | Acento | Licencia | Limitación |
|---|---|---|---|
| [CML-TTS español](https://www.openslr.org/146/) (OpenSLR 146) | Varios (audiolibros) | CC BY 4.0 | Archivo de unos **48 GB**. Hay copias filtradas en Hugging Face (`freds0/cml_tts_dataset_spanish`, `andjelajo/cml_tts_dataset_spanish-filtered-9972`), con la licencia sin verificar |
| [CIEMPIESS](http://www.ciempiess.org/downloads) (Light, Balance, Fem…) | México | CC BY-SA 4.0 | Grabado en radio; pensado para reconocimiento de voz, no para TTS |
| [TEDx Spanish](https://www.openslr.org/67/) (OpenSLR 67) | México, Argentina, otros | CC BY-SA 4.0 | Charlas: hay ruido de sala y expresión espontánea |
| [VoxForge (es)](http://www.voxforge.org) | España, México, Argentina | **GPL** | Calidad irregular. GPL es una licencia pensada para software: consúltalo antes de un uso comercial. La usa [cami-sosa/qwen3-tts-spanish-voices](https://github.com/cami-sosa/qwen3-tts-spanish-voices) para 12 voces clonadas |
| [Open Speech Corpus](http://openspeechcorpus.contraslash.com) | Colombia, Venezuela | MIT | Grabaciones con ruido |
| [Kaggle: slr-latam-es-voices](https://www.kaggle.com/datasets/igortamara/slr-latam-es-voices) | 6 países LATAM | CC BY-SA 4.0 (de OpenSLR) | Remuestreado a 22,05 kHz y requiere cuenta de Kaggle. Para Pocket TTS es mejor la copia de GianDiego, a 24 kHz |
| M-AILABS (es) | Varios (LibriVox) | Licencia propia | Hay que leer la licencia antes de usarlo |

---

## 5. Fuentes que conviene evitar

| Fuente | Motivo |
|---|---|
| `HirCoir/es_MX-Cortana-…`, `HirCoir/es_mx-Astra` y similares | Por el nombre, imitan voces de asistentes comerciales. La procedencia y el consentimiento no están claros |
| [Open Swara](https://github.com/jaymunshi/open-swara) | Voces sintéticas "humanizadas" con un proceso propietario. El origen real de cada voz no es trazable |
| `projecte-aina/synthetic_dem` | Es **voz sintética**: clonarla copia artefactos de otro TTS |
| Nexdata, DataoceanAI, SpeechDataAI y otros comerciales | Son de pago. Las muestras gratuitas no dan derecho a usarlos |
| TikTok, YouTube, películas, locutores famosos | Sugerido en [r/TextToSpeech](https://www.reddit.com/r/TextToSpeech/comments/1s06pf0/voices_to_clone/), pero **no** hay consentimiento ni licencia |
| `HISPASpoof` | Es un dataset de *spoofing* (incluye audio falso a propósito) |
| DIMEx100, Heroico | Solo uso académico, o el acuerdo de usuario de LDC |

---

## 6. Colecciones listas para clonar (no españolas)

Sirven para tener timbres distintos (hablarán español con acento extranjero) o como modelo de cómo organizar una colección propia:

| Colección | Voces | Licencia | Nota |
|---|---|---|---|
| [kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices) | Varias carpetas (VCTK, Expresso, donaciones, etc.) | Según la carpeta: CC0, CC BY 4.0 o **CC BY-NC** (Expresso) | Detalle en [Pocket TTS](pocket-tts.md) |
| Donaciones de voz de Kyutai (`voice-donations/`) | 228 voces (912 archivos, con versiones `_enhanced`) | CC0 | **No indican el idioma**: habría que escucharlas o detectar el idioma con un modelo de reconocimiento de voz (por ejemplo, Whisper) |
| [OwenTyme/voice-zero](https://github.com/OwenTyme/voice-zero) | 98 voces + variantes emocionales | CC0 | **Solo inglés**: el mantenedor no acepta voces en otros idiomas |
| [OHF-Voice/voice-datasets](https://github.com/OHF-Voice/voice-datasets) | 1 voz por idioma | CC0 | Para el español solo está **Dave** (es_ES) |

---

## 7. Cómo ampliar `scripts/get_voices.py`

**Idea, no implementada.** Mantiene el método actual (la API de filas, sin descargar datasets enteros):

1. Añadir el origen `GianDiego/latam-spanish-speech-orpheus-tts-24khz`, con config `default` y split `train`.
2. Usar el endpoint `/filter` del *datasets-server*, por ejemplo `where="nationality"='pe' AND "gender"='f'`. En la primera consulta respondió *"the dataset index is loading"*: el índice tarda en prepararse y hay que reintentar más tarde.
3. Agrupar las frases por `(nationality, gender, speaker_id)`. **Cuidado:** el mismo `speaker_id` aparece en países y géneros distintos (por ejemplo `05223`), así que **no identifica por sí solo a una persona**.
4. Añadir Dave y Ald como descargas directas.
5. Anotar la licencia de cada voz en `voices/ATTRIBUTION.txt`.

---

## 8. Cómo preparar una buena referencia

Basado en el *issue* [#115](https://github.com/kyutai-labs/pocket-tts/issues/115) y en la documentación oficial:

1. **Duración:** de 10 a 30 s. Pocket TTS recorta a 30 s y corta en la última pausa.
2. **Limpieza:** sin música, eco ni ruido. El modelo copia las condiciones acústicas de la muestra.
3. **Variedad:** que incluya una afirmación, una pregunta y una exclamación, para que el modelo aprenda la entonación.
4. **Mejorar el audio** con herramientas gratuitas: [resemble-enhance](https://github.com/resemble-ai/resemble-enhance) (MIT), [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) (necesita WAV a 48 kHz), RNNoise o Audacity.
5. **Un solo hablante:** no mezcles frases de varias personas. Revisa el punto 3 de la sección 7.
6. **Formato:** WAV mono. Lo ideal es 24 kHz, aunque Pocket TTS remuestrea si hace falta.
7. **Exportar:** con `pocket-tts export-voice` la voz se guarda como `.safetensors` y se carga al instante.

---

## 9. Fuentes consultadas

1. Hugging Face, API de datasets y *datasets-server* (`/info`, `/rows`, `/statistics`, `/filter`): consultas del 29/10/2026.
2. OpenSLR: [61](https://www.openslr.org/61/), [67](https://www.openslr.org/67/), [71](https://www.openslr.org/71/), [72](https://www.openslr.org/72/), [73](https://www.openslr.org/73/), [74](https://www.openslr.org/74/), [75](https://www.openslr.org/75/), [146](https://www.openslr.org/146/).
3. [OHF-Voice/voice-datasets](https://github.com/OHF-Voice/voice-datasets) y [Dave 1.0 en Mozilla Data Collective](https://mozilladatacollective.com/datasets/cmid4ir9100bgnu07du03svuc).
4. [Common Voice 27.0 (es)](https://mozilladatacollective.com/datasets/cmu5kitx700pemi073feoiqqu).
5. [open-speech-org/openspeechresources](https://github.com/open-speech-org/openspeechresources): recopilación de recursos de voz en español.
6. [OwenTyme/voice-zero](https://github.com/OwenTyme/voice-zero).
7. [kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices).
8. [Reddit r/TextToSpeech, "Voices to clone"](https://www.reddit.com/r/TextToSpeech/comments/1s06pf0/voices_to_clone/).
9. [Kaggle slr-latam-es-voices](https://www.kaggle.com/datasets/igortamara/slr-latam-es-voices).
10. [cami-sosa/qwen3-tts-spanish-voices](https://github.com/cami-sosa/qwen3-tts-spanish-voices), [alblez/qwen3-tts-spanish-voices](https://github.com/alblez/qwen3-tts-spanish-voices).
11. [pocket-tts issue #115](https://github.com/kyutai-labs/pocket-tts/issues/115).
