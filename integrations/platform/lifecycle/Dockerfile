FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.mjs *.sql ./
USER node
EXPOSE 8097
CMD ["node", "main.mjs", "serve"]
