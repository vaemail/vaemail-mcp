# Image du serveur MCP VaEmail.
# Aucune dependance externe : le paquet n'en a pas, on copie les sources et on
# demarre. Node 18 est le minimum declare dans package.json.
FROM node:20-alpine

WORKDIR /app

# bin et lib suffisent, ce sont les seuls fichiers publies par le paquet.
COPY package.json ./
COPY bin ./bin
COPY lib ./lib

# Le serveur n'ecoute sur aucun port : il parle en MCP sur stdio.
# La cle d'API se passe a l'execution, jamais dans l'image :
#   docker run -i -e VAEMAIL_API_KEY=swm_xxx vaemail-mcp
ENV NODE_ENV=production
USER node

ENTRYPOINT ["node", "bin/vaemail-mcp.js"]
