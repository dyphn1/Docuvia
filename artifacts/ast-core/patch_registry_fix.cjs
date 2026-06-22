const fs = require('fs');
let content = fs.readFileSync('src/language-registry.ts', 'utf8');

const missingMethods = `
  public getProviderForExtension(ext: string): LanguageProvider | undefined {
    return this.extToProviderMap.get(ext);
  }

  public getConfig(): LanguageRegistryData {
    return this.config;
  }
}
`;

content = content.replace(/}\s*$/, missingMethods);
fs.writeFileSync('src/language-registry.ts', content);
