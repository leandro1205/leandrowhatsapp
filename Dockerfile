FROM node:20-alpine

WORKDIR /app

# Copia manifestos primeiro para aproveitar cache
COPY package*.json ./

# Sem package-lock? Use install (não ci)
RUN npm install --omit=dev

# Copia o código
COPY ./src ./src

ENV PORT=3000
EXPOSE 3000

# Inicia a app
CMD ["npm", "start"]
