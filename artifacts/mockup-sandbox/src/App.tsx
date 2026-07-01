import { modules as discoveredModules } from "./.generated/mockup-components";
import { PreviewRenderer, type ModuleMap } from "./components/PreviewRenderer";
import { Gallery } from "./components/Gallery";
import { getPreviewPath } from "./lib/preview-utils";

function App() {
  const previewPath = getPreviewPath();

  if (previewPath) {
    return <PreviewRenderer componentPath={previewPath} modules={discoveredModules as ModuleMap} />;
  }

  return <Gallery />;
}

export default App;
