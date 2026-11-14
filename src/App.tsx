import { FocusSpaceProvider } from "./focus/FocusSpaceContext";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import "./styles/workspace.css";

function App() {
  return (
    <FocusSpaceProvider>
      <WorkspaceShell />
    </FocusSpaceProvider>
  );
}

export default App;
