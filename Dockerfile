FROM node:24-alpine
WORKDIR /app
COPY analyst ./analyst
COPY proof-workbench.html proof-workbench.css proof-workbench.js proof-workbench-integrity.js brand-tokens.css ./
COPY proof-data ./proof-data
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node","analyst/server.cjs"]
