import { FocusSpaceProvider } from "./focus/FocusSpaceContext";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import "./styles/dace-cinematic.css";

function App() {
  return (
    <FocusSpaceProvider>
      <WorkspaceShell />
    </FocusSpaceProvider>
  );
}

export default App;
