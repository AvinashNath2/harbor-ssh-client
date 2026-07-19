# FAQ

## General

### Is HarborSCP free?

Yes, HarborSCP is free and open-source under the MIT license.

### What platforms does HarborSCP support?

macOS (Apple Silicon + Intel), Windows (x64), and Linux (x64). All from the same codebase via Tauri.

### Where are my credentials stored?

Passwords are **not** stored. You re-enter them each time you connect. SSH key paths are stored in your connection profile, but the key itself stays on disk where you put it.

Session logs (command history) are stored locally in a SQLite database — nothing is sent anywhere.

---

## Connections

### Why does my connection fail with "Authentication rejected"?

- Check that your username is correct
- For password auth: verify the password works in a terminal first (`ssh user@host`)
- For key auth: confirm the key path is correct and the key is added to `~/.ssh/authorized_keys` on the server

### Can I connect to servers behind a bastion/jump host?

Not directly in the UI yet. You can work around this with an SSH tunnel in your terminal (`ssh -L`) or by adding a `ProxyJump` directive to `~/.ssh/config` and importing that profile.

### The connection drops frequently. What can I do?

HarborSCP sends SSH keepalive packets every 30 seconds to keep the connection alive. If your server or network is aggressive about dropping idle connections, add to your server's `sshd_config`:

```
ClientAliveInterval 60
ClientAliveCountMax 3
```

---

## File operations

### Can I copy files between two remote servers?

Not yet. You can download to local and re-upload. This is on the roadmap.

### What's the maximum file size for transfers?

There is no hard limit. Large files are streamed in chunks. For very large files (GB+), progress is shown in the Transfer panel.

### Why does file preview show garbled text?

The file is likely binary. Switch to hex view using the toggle in the preview panel.

---

## Port forwarding

### My tunnel shows "active" but I can't connect to the local port.

Check that the remote service is actually running on the host/port you specified. Test from the server itself:
```bash
curl http://localhost:8080      # for HTTP
redis-cli -h localhost ping     # for Redis
```

### Redis isn't accessible via tunnel to `localhost:6379`.

Redis in Docker may not be bound to the host — check with `docker ps` if the port shows `0.0.0.0:6379` or just `6379/tcp`. If it's the latter, get the container IP:
```bash
docker inspect redis --format '{{.NetworkSettings.IPAddress}}'
```
Then use that IP as the Remote Host in the tunnel config instead of `localhost`.

---

## Troubleshooting

### The app window is blank on launch.

Restart the app. If the problem persists, delete the app's data directory (see [Configuration](configuration.md#session-log-storage)) and relaunch.

### I get "Port already in use" when adding a tunnel.

Another process is already using that local port. Either stop it or choose a different local port (e.g. use `5433` instead of `5432`).

### How do I report a bug?

Open a [Bug Report](https://github.com/AvinashNath2/harbor-ssh-client/issues/new?template=bug_report.yml) on GitHub with your OS version, HarborSCP version, and steps to reproduce.
