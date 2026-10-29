import { useEffect, useState } from "react";
import { aiRequest, type AiSettings } from "./aiApi";
import "./aiReview.css";

export type AiOptions = {
  provider: "openai" | "claude";
  model: string;
  allow_cloud_upload: boolean;
  detail: string;
};

export function AiControls({ busy, onRun }: { busy: boolean; onRun: (options: AiOptions) => Promise<void> }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<"openai" | "claude">("openai");
  const [model, setModel] = useState("gpt-6-luna");
  const [inputPrice, setInputPrice] = useState("0.1");
  const [outputPrice, setOutputPrice] = useState("0.5");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    aiRequest<AiSettings>("/settings", undefined, controller.signal)
      .then(setSettings)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, []);
  async function save() {
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      const next = await aiRequest<AiSettings>("/settings", {
        ...settings,
        prices: {
          ...settings.prices,
          [`${provider}:${model}`]: { input: Number(inputPrice), output: Number(outputPrice) }
        }
      });
      setSettings(next);
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="ai-controls">
      <div className="ai-fields">
        <label>
          Provider
          <select
            value={provider}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value as "openai" | "claude";
              setProvider(value);
              setModel(value === "openai" ? "gpt-6-luna" : "");
              setConsent(false);
              if (value === "claude") {
                setInputPrice("");
                setOutputPrice("");
              } else {
                setInputPrice("0.1");
                setOutputPrice("0.5");
              }
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          Model
          <input
            aria-label="AI model"
            value={model}
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
      </div>
      <details className="ai-settings">
        <summary>Cloud settings & budgets</summary>
        {settings ? (
          <>
            <label className="ai-check">
              <input
                type="checkbox"
                checked={settings.cloud_enabled}
                onChange={(event) => setSettings({ ...settings, cloud_enabled: event.target.checked })}
              />
              Enable cloud API on this computer
            </label>
            <div className="ai-fields">
              <label>
                Input USD / 1M tokens
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={inputPrice}
                  onChange={(event) => setInputPrice(event.target.value)}
                />
              </label>
              <label>
                Output USD / 1M tokens
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={outputPrice}
                  onChange={(event) => setOutputPrice(event.target.value)}
                />
              </label>
              {(["request_limit_usd", "batch_limit_usd", "monthly_limit_usd"] as const).map((key) => (
                <label key={key}>
                  {key === "request_limit_usd"
                    ? "Per request USD"
                    : key === "batch_limit_usd"
                      ? "Per batch USD"
                      : "Monthly USD"}
                  <input
                    type="number"
                    min="0.001"
                    step="0.01"
                    value={settings[key]}
                    onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })}
                  />
                </label>
              ))}
            </div>
            <p>
              Prices are editable estimates. Keys stay on this computer. Save settings before requesting a
              review.
            </p>
            <button type="button" disabled={saving || busy || !model.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : "Save AI settings"}
            </button>
          </>
        ) : (
          <p>Loading settings…</p>
        )}
      </details>
      <label className="ai-check">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
        />
        Allow uploading this image preview and task context to the selected provider
      </label>
      <button
        type="button"
        className="ui-btn--primary"
        disabled={busy || saving || !consent || !model.trim() || !settings?.cloud_enabled}
        onClick={() =>
          void onRun({ provider, model: model.trim(), allow_cloud_upload: consent, detail: "high" })
        }
      >
        {busy ? "Reviewing…" : "Request AI review"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {!settings?.cloud_enabled ? <p>Cloud API is off. Local tools remain available.</p> : null}
    </div>
  );
}
