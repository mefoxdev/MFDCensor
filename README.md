# MFDCensor

## Deployment

The bot is deployed as a rootless Podman container. GitHub Actions builds and
publishes `ghcr.io/mefoxdev/mfdcensor:latest` on each push to `main`.

On the server, install Podman and log in to GitHub Container Registry if the
image package is private:

```sh
podman login ghcr.io
```

Create persistent local directories and configuration:

```sh
mkdir -p ~/.config/mfdcensor ~/.local/share/mfdcensor/data ~/.config/containers/systemd
cp config.example.toml ~/.config/mfdcensor/config.toml
chmod 600 ~/.config/mfdcensor/config.toml
```

Set the bot token and owner ID in `~/.config/mfdcensor/config.toml`. Install
the Quadlet unit, enable the bot and automatic image updates:

```sh
cp deploy/mfdcensor.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user enable --now mfdcensor.service
systemctl --user enable --now podman-auto-update.timer
loginctl enable-linger "$USER"
```

After a push to `main`, `podman-auto-update` pulls the latest image and
restarts the service. Inspect the bot with:

```sh
systemctl --user status mfdcensor.service
journalctl --user -u mfdcensor.service -f
```
