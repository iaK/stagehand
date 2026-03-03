FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Core system deps + Tauri requirements + desktop environment
RUN apt-get update && apt-get install -y \
    # Build essentials
    curl wget git build-essential pkg-config \
    # Tauri Linux deps (WebKit + GTK)
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libssl-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
    # Desktop environment (lightweight)
    xfce4 xfce4-terminal dbus-x11 \
    # VNC + noVNC for browser access
    tigervnc-standalone-server tigervnc-common novnc websockify \
    # Misc
    sudo file xdg-utils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Set up VNC
RUN mkdir -p /root/.vnc && \
    echo "password" | vncpasswd -f > /root/.vnc/passwd && \
    chmod 600 /root/.vnc/passwd

# VNC startup config
RUN echo '#!/bin/sh\nstartxfce4 &' > /root/.vnc/xstartup && \
    chmod +x /root/.vnc/xstartup

# Startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /app

# Copy project files
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Pre-build Rust deps (this layer gets cached)
RUN cd src-tauri && cargo fetch

EXPOSE 6080

ENTRYPOINT ["/docker-entrypoint.sh"]
