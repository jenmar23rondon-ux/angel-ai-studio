import { Activity, ImagePlus, Images, Mic2, ShieldCheck, Sparkles, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createGeneration, Generation, GenerationMode, listGenerations, VoiceOptions } from "./services/api";

const modes: Array<{ id: GenerationMode; label: string; icon: typeof Sparkles }> = [
  { id: "image", label: "Text to image", icon: Sparkles },
  { id: "edit", label: "Edit image", icon: ImagePlus },
  { id: "avatar", label: "Avatar", icon: ShieldCheck },
  { id: "video", label: "Image to video", icon: Video },
  { id: "audio", label: "Voice Studio", icon: Mic2 }
];

const samples: Generation[] = [
  {
    id: "demo-1",
    type: "image",
    prompt: "Editorial product portrait with clean light and deep teal background",
    status: "completed",
    outputUrl:
      "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=80",
    createdAt: new Date().toISOString()
  },
  {
    id: "demo-2",
    type: "audio",
    prompt: "Convert my recorded Spanish audio to English while preserving tone and emotion",
    status: "processing",
    metadata: {
      voiceMode: "translation",
      targetLanguage: "English",
      accent: "Neutral US"
    },
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString()
  }
];

const defaultVoiceOptions: VoiceOptions = {
  voiceMode: "voice-conversion",
  targetVoice: "Designed studio voice",
  accent: "Neutral US",
  targetLanguage: "English",
  emotion: "Natural",
  preserveEmotion: true,
  removeNoise: true
};

export function App() {
  const [mode, setMode] = useState<GenerationMode>("image");
  const [prompt, setPrompt] = useState("Create a cinematic studio portrait for a consent-based AI avatar profile.");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOptions>(defaultVoiceOptions);
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [generations, setGenerations] = useState<Generation[]>(samples);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listGenerations()
      .then((items) => items.length && setGenerations(items))
      .catch(() => {
        setGenerations(samples);
      });
  }, []);

  const stats = useMemo(
    () => ({
      completed: generations.filter((item) => item.status === "completed").length,
      queued: generations.filter((item) => item.status === "queued" || item.status === "processing").length
    }),
    [generations]
  );

  async function submitGeneration() {
    setError("");
    setIsSubmitting(true);

    try {
      const generation = await createGeneration({
        type: mode,
        prompt,
        consentConfirmed,
        voiceOptions: mode === "audio" ? voiceOptions : undefined
      });
      setGenerations((current) => [generation, ...current.filter((item) => !item.id.startsWith("demo-"))]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Generation failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateVoiceOption<Key extends keyof VoiceOptions>(key: Key, value: VoiceOptions[Key]) {
    setVoiceOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">a</div>
          <div>
            <strong>angel-ai-studio</strong>
            <span>AI media and voice studio</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <button className={mode === item.id ? "active" : ""} key={item.id} onClick={() => setMode(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="safety-note">
          <ShieldCheck size={18} />
          <p>Consent checks, private files, signed URLs, audit logs and abuse prevention are first-class paths.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Generation workspace</h1>
            <p>Build images, avatars, edits, videos and voice transformations through one guarded pipeline.</p>
          </div>
          <div className="status-pills">
            <span>
              <Activity size={16} />
              {stats.queued} active
            </span>
            <span>
              <Images size={16} />
              {stats.completed} ready
            </span>
          </div>
        </header>

        <section className="generator-layout">
          <div className="creator-panel">
            <div className="panel-header">
              <h2>{modes.find((item) => item.id === mode)?.label}</h2>
              <span>Provider: mock adapter</span>
            </div>

            <label className="field">
              {mode === "audio" ? "Voice task" : "Prompt"}
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} />
            </label>

            {mode === "audio" && (
              <div className="voice-controls">
                <label className="field">
                  Mode
                  <select
                    value={voiceOptions.voiceMode}
                    onChange={(event) => updateVoiceOption("voiceMode", event.target.value as VoiceOptions["voiceMode"])}
                  >
                    <option value="voice-conversion">Change voice, keep words</option>
                    <option value="accent">Change accent</option>
                    <option value="translation">Translate with voice</option>
                  </select>
                </label>

                <label className="field">
                  Target voice
                  <select
                    value={voiceOptions.targetVoice}
                    onChange={(event) => updateVoiceOption("targetVoice", event.target.value)}
                  >
                    <option>Designed studio voice</option>
                    <option>My cloned voice</option>
                    <option>Warm narrator</option>
                    <option>Clear assistant</option>
                  </select>
                </label>

                <label className="field">
                  Accent
                  <select value={voiceOptions.accent} onChange={(event) => updateVoiceOption("accent", event.target.value)}>
                    <option>Neutral US</option>
                    <option>British</option>
                    <option>Mexican Spanish</option>
                    <option>Colombian Spanish</option>
                    <option>Brazilian Portuguese</option>
                  </select>
                </label>

                <label className="field">
                  Language
                  <select
                    value={voiceOptions.targetLanguage}
                    onChange={(event) => updateVoiceOption("targetLanguage", event.target.value)}
                  >
                    <option>English</option>
                    <option>Spanish</option>
                    <option>Portuguese</option>
                    <option>French</option>
                  </select>
                </label>

                <label className="field">
                  Emotion
                  <select value={voiceOptions.emotion} onChange={(event) => updateVoiceOption("emotion", event.target.value)}>
                    <option>Natural</option>
                    <option>Calm</option>
                    <option>Energetic</option>
                    <option>Serious</option>
                  </select>
                </label>

                <label className="toggle-row">
                  <input
                    checked={voiceOptions.preserveEmotion}
                    onChange={(event) => updateVoiceOption("preserveEmotion", event.target.checked)}
                    type="checkbox"
                  />
                  Preserve rhythm and emotion
                </label>

                <label className="toggle-row">
                  <input
                    checked={voiceOptions.removeNoise}
                    onChange={(event) => updateVoiceOption("removeNoise", event.target.checked)}
                    type="checkbox"
                  />
                  Remove background noise first
                </label>
              </div>
            )}

            <div className="upload-slot">
              {mode === "audio" ? <Mic2 size={22} /> : <ImagePlus size={22} />}
              <span>{mode === "audio" ? "Drop audio file or record from the browser" : "Drop source image or training photos here"}</span>
              <small>{mode === "audio" ? "Audio upload and recording flow is scaffolded for MP3/WAV." : "Upload endpoint is scaffolded for S3 signed URLs."}</small>
            </div>

            <label className="consent-row">
              <input
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                type="checkbox"
              />
              I confirm I have rights and consent for all source media and voices.
            </label>

            {error && <p className="error-message">{error}</p>}

            <button className="primary-action" disabled={isSubmitting || !prompt.trim()} onClick={submitGeneration}>
              <Sparkles size={18} />
              {isSubmitting ? "Queuing..." : mode === "audio" ? "Create voice job" : "Create generation"}
            </button>
          </div>

          <div className="gallery-panel">
            <div className="panel-header">
              <h2>Private gallery</h2>
              <span>{generations.length} items</span>
            </div>

            <div className="gallery-grid">
              {generations.map((item) => (
                <article className="asset-card" key={item.id}>
                  {item.outputUrl ? (
                    <img alt={item.prompt} src={item.outputUrl} />
                  ) : (
                    <div className="asset-placeholder">
                      <Sparkles size={24} />
                    </div>
                  )}
                  <div>
                    <strong>{item.type}</strong>
                    <span className={`status ${item.status}`}>{item.status}</span>
                  </div>
                  <p>{item.prompt}</p>
                  {item.type === "audio" && item.metadata && (
                    <small className="asset-meta">
                      {String(item.metadata.voiceMode ?? "voice")} · {String(item.metadata.targetLanguage ?? "same language")} ·{" "}
                      {String(item.metadata.accent ?? "native accent")}
                    </small>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
