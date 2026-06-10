import { useFeatureFlags } from "./features";

export function App() {
  const flags = useFeatureFlags();

  return (
    <main
      style={{ fontFamily: "system-ui", maxWidth: 600, margin: "4rem auto" }}
    >
      <h1>krillswitch demo</h1>
      <p>
        Flags render instantly from last-known values (manifest defaults on a
        cold profile) and update in place when the fetch settles.
      </p>
      {flags.souls ? (
        <section data-flag="souls">
          <h2>👻 Souls is ON</h2>
          <p>This section only renders when the souls flag serves true.</p>
        </section>
      ) : (
        <p data-flag="souls">Souls is off — flag-gated section hidden.</p>
      )}
      <dl>
        <dt>theme</dt>
        <dd>
          <code>{flags.theme}</code>
        </dd>
        <dt>rollout-demo</dt>
        <dd>
          <code>{flags["rollout-demo"]}</code>
        </dd>
        <dt>anonymous context key</dt>
        <dd>
          <code>
            {localStorage.getItem("krillswitch.anonymousKey") ?? "(none yet)"}
          </code>
        </dd>
      </dl>
    </main>
  );
}
