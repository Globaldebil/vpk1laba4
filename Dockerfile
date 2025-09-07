FROM node:latest

WORKDIR /app

COPY package*.json ./

RUN npm install bcryptjs ejs express express-session pg sequelize

COPY . .

RUN mkdir -p data

EXPOSE 3000

CMD ["npm", "start"]

LABEL version="1.0"