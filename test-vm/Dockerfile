FROM lscr.io/linuxserver/openssh-server:latest

# linuxserver/openssh-server gives us a working SSH server with password auth
# out of the box. User/password are set via env vars at runtime (see compose).

# Install coreutils, findutils, gzip for the storage analyzer commands
RUN apk add --no-cache \
    coreutils \
    findutils \
    gzip \
    procps \
    sudo \
    util-linux \
    bash \
    openssl

# Add the test user to sudoers (passwordless) so Cleanup Center presets work
RUN echo 'harbor ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

COPY setup-testdata.sh /custom-cont-init.d/01-testdata.sh
RUN chmod +x /custom-cont-init.d/01-testdata.sh

EXPOSE 2222
