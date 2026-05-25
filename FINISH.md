# Finish Publishing A1Zap Bots CLI

1. Create a GitHub repo named `a1zap-bots-cli` under `a1baseai`.
2. Initialize and commit this folder:

```bash
npm run repo:init
```

Or do it manually:

```bash
git init
git add .
git commit -m "Initial A1Zap bots CLI"
git branch -M main
```

3. Add the GitHub remote and push:

```bash
git remote add origin git@github.com:a1baseai/a1zap-bots-cli.git
git push -u origin main
```

4. Install from GitHub while npm publishing is pending:

```bash
npm install -g github:a1baseai/a1zap-bots-cli
```

5. Publish to npm when ready:

```bash
npm login
npm publish --access public
```

6. Verify the gateway path:

```bash
a1zap-bots --json doctor --setup-live
a1zap-bots login
a1zap-bots hermes bootstrap --name "Campus Planner" --write-env
a1zap-bots hermes doctor --live
hermes gateway setup
hermes gateway run
```
