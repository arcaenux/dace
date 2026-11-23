import { FocusSpaceProvider } from "./focus/FocusSpaceContext";
import { SettingsProvider } from "./settings/SettingsContext";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import "./styles/dace-cinematic.css";

function App() {
  return (
    <SettingsProvider>
      <FocusSpaceProvider>
        <WorkspaceShell />
      </FocusSpaceProvider>
    </SettingsProvider>
  );
}

export default App;
