# Audio Studio

Angel AI Studio includes a voice workflow for recorded audio:

- Browser microphone recording with local playback.
- Speech-to-speech voice conversion while preserving words, rhythm and emotion.
- Accent conversion for English, Spanish and Portuguese variants.
- Transcription, translation and text-to-speech for multilingual voice output.
- Noise removal before generation.
- Consent-first voice cloning and designed voices only.

The local `audio-service` is a FastAPI mock boundary. Production provider adapters can connect ElevenLabs, OpenAI, fal.ai or Replicate without changing the web/API contract.

The current web recording flow keeps the audio blob in the browser for preview. The production flow should upload it through a signed private URL, enqueue an audio job, and store the generated MP3 in private object storage.

## Local Endpoints

- `GET http://localhost:8100/health`
- `POST http://localhost:8100/voice/jobs`

## MVP Flow

```text
Recorded audio or uploaded MP3/WAV
        -> noise removal
        -> voice conversion, accent conversion, or translation
        -> generated MP3
        -> private S3 object
        -> gallery playback or download
```
