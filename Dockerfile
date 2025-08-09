FROM node:20-slim

# Instalar Git e dependências básicas
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# Diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependência
COPY package.json package-lock.json* ./

# Instalar dependências
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copiar restante do código
COPY . .

# Porta
EXPOSE 3000

# Variável de ambiente
ENV NODE_ENV=production

# Entrypoint e comando
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
