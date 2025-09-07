const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { 
    User, 
    CurrencyRate, 
    ConversionHistory, 
    UserCurrency,
    initializeDatabase 
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка шаблонизатора EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'currency-converter-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Middleware для проверки аутентификации
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Получение курсов пользователя
async function getUserRates(userId) {
    try {
        const userRates = await UserCurrency.findAll({
            where: { userId },
            include: [{
                model: CurrencyRate,
                attributes: ['currencyCode', 'rate', 'isBase']
            }]
        });

        const rates = {};
        userRates.forEach(userRate => {
            rates[userRate.CurrencyRate.currencyCode] = parseFloat(userRate.rate);
        });

        // Если у пользователя нет курсов, создаем из базовых
        if (Object.keys(rates).length === 0) {
            const baseRates = await CurrencyRate.findAll();
            for (const baseRate of baseRates) {
                await UserCurrency.create({
                    userId,
                    currencyId: baseRate.id,
                    rate: baseRate.rate
                });
                rates[baseRate.currencyCode] = parseFloat(baseRate.rate);
            }
        }

        return rates;
    } catch (error) {
        console.error('Error getting user rates:', error);
        return {};
    }
}


// Функция конвертации валют
function convertCurrency(amount, fromCurrency, toCurrency, userRates) {
    if (!userRates[fromCurrency] || !userRates[toCurrency]) {
        throw new Error('Неизвестная валюта');
    }
    
    const amountInUSD = amount / userRates[fromCurrency];
    const convertedAmount = amountInUSD * userRates[toCurrency];
    const conversionRate = userRates[toCurrency] / userRates[fromCurrency];
    
    return {
        result: parseFloat(convertedAmount.toFixed(4)),
        rate: parseFloat(conversionRate.toFixed(6))
    };
}

// Маршруты аутентификации
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { 
        title: 'Вход',
        error: req.query.error,
        message: req.query.message
    });
});

app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('register', { 
        title: 'Регистрация',
        error: req.query.error
    });
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.redirect('/login?error=Все поля обязательны');
        }

        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.redirect('/login?error=Пользователь не найден');
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.redirect('/login?error=Неверный пароль');
        }

        req.session.user = { 
            id: user.id, // UUID вместо INTEGER
            username: user.username 
        };
        res.redirect('/');

    } catch (error) {
        console.error('Login error:', error);
        res.redirect('/login?error=Ошибка сервера');
    }
});

// Регистрация пользователя
app.post('/register', async (req, res) => {
    try {
        const { username, password, confirmPassword } = req.body;
        
        if (!username || !password || !confirmPassword) {
            return res.redirect('/register?error=Все поля обязательны');
        }

        if (password !== confirmPassword) {
            return res.redirect('/register?error=Пароли не совпадают');
        }

        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.redirect('/register?error=Пользователь уже существует');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            username,
            password: hashedPassword
        });

        // Создаем персональные курсы для пользователя
        const baseRates = await CurrencyRate.findAll();
        for (const rate of baseRates) {
            await UserCurrency.create({
                userId: user.id, // UUID автоматически
                currencyId: rate.id,
                rate: rate.rate
            });
        }

        res.redirect('/login?message=Регистрация успешна. Войдите в систему');

    } catch (error) {
        console.error('Registration error:', error);
        res.redirect('/register?error=Ошибка сервера');
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Основные маршруты
app.get('/', requireAuth, async (req, res) => {
    try {
        const userRates = await getUserRates(req.session.user.id);
        res.render('index', { 
            currencies: Object.keys(userRates),
            title: 'Конвертер валют',
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading index:', error);
        res.redirect('/login');
    }
});

app.post('/convert', requireAuth, async (req, res) => {
    try {
         const userRates = await getUserRates(req.session.user.id);
        const { amount, fromCurrency, toCurrency } = req.body;
        
        if (!amount || !fromCurrency || !toCurrency) {
            return res.status(400).render('convert', {
                error: 'Все поля обязательны для заполнения',
                amount,
                fromCurrency,
                toCurrency,
                currencies: Object.keys(userRates),
                user: req.session.user
            });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).render('convert', {
                error: 'Введите корректную сумму',
                amount,
                fromCurrency,
                toCurrency,
                currencies: Object.keys(userRates),
                user: req.session.user
            });
        }

        const conversion = convertCurrency(numericAmount, fromCurrency, toCurrency, userRates);
        
        // Сохраняем в историю
        await ConversionHistory.create({
            userId: req.session.user.id, // UUID
            amount: numericAmount,
            fromCurrency,
            toCurrency,
            rate: conversion.rate,
            result: conversion.result,
            convertedAt: new Date()
        });

        res.render('convert', {
            amount: numericAmount,
            fromCurrency,
            toCurrency,
            result: conversion.result,
            rate: conversion.rate,
            currencies: Object.keys(userRates),
            success: true,
            error: null,
            user: req.session.user
        });

    } catch (error) {
        const userRates = await getUserRates(req.session.user.id);
        res.status(400).render('convert', {
            error: error.message,
            amount: req.body.amount,
            fromCurrency: req.body.fromCurrency,
            toCurrency: req.body.toCurrency,
            currencies: Object.keys(userRates),
            success: false,
            user: req.session.user
        });
    }
});

app.get('/rates', requireAuth, async (req, res) => {
    try {
        const userRates = await getUserRates(req.session.user.id);
        res.render('rates', {
            rates: userRates,
            title: 'Мои курсы валют',
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading rates:', error);
        res.redirect('/');
    }
});

// История конвертаций
app.get('/history', requireAuth, async (req, res) => {
    try {
        const history = await ConversionHistory.findAll({
            where: { userId: req.session.user.id }, // UUID
            order: [['convertedAt', 'DESC']],
            limit: 50
        });

        res.render('history', {
            history,
            title: 'История конвертаций',
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading history:', error);
        res.redirect('/');
    }
});

app.get('/admin/rates', requireAuth, async (req, res) => {
    try {
        const userRates = await getUserRates(req.session.user.id);
        
        res.render('admin-rates', {
            rates: userRates,
            title: 'Мой редактор курсов',
            message: req.query.message,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading admin rates:', error);
        res.redirect('/admin/rates?message=Ошибка загрузки курсов');
    }
});


app.post('/admin/rates/update', requireAuth, async (req, res) => {
    try {
        const { currencyCode, rate } = req.body;
        
        if (!currencyCode || !rate) {
            return res.redirect('/admin/rates?message=Все поля обязательны для заполнения');
        }

        const numericRate = parseFloat(rate);
        if (isNaN(numericRate) || numericRate <= 0) {
            return res.redirect('/admin/rates?message=Введите корректное значение курса');
        }

        // Находим валюту в базе
        const currency = await CurrencyRate.findOne({ 
            where: { currencyCode: currencyCode.toUpperCase() } 
        });
        
        if (!currency) {
            return res.redirect('/admin/rates?message=Валюта не найдена в системе');
        }

        // Находим или создаем запись пользовательского курса
        const [userCurrency, created] = await UserCurrency.findOrCreate({
            where: {
                userId: req.session.user.id,
                currencyId: currency.id
            },
            defaults: {
                rate: numericRate
            }
        });

        if (!created) {
            // Обновляем существующий курс
            await userCurrency.update({ rate: numericRate });
        }

        res.redirect('/admin/rates?message=Курс успешно обновлен');

    } catch (error) {
        console.error('Error updating rate:', error);
        res.redirect('/admin/rates?message=Ошибка при обновлении курса');
    }
});

app.post('/admin/rates/reset', requireAuth, async (req, res) => {
    try {
        // Получаем базовые курсы
        const baseRates = await CurrencyRate.findAll();
        
        // Удаляем все персональные курсы пользователя
        await UserCurrency.destroy({
            where: {
                userId: req.session.user.id
            }
        });

        // Создаем новые курсы из базовых
        for (const baseRate of baseRates) {
            await UserCurrency.create({
                userId: req.session.user.id,
                currencyId: baseRate.id,
                rate: baseRate.rate
            });
        }

        res.redirect('/admin/rates?message=Курсы сброшены к базовым значениям');

    } catch (error) {
        console.error('Error resetting rates:', error);
        res.redirect('/admin/rates?message=Ошибка при сбросе курсов');
    }
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        message: 'Что-то пошло не так!',
        user: req.session?.user 
    });
});

async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`Сервер запущен на http://localhost:${PORT}`);
            console.log('Доступные маршруты:');
            console.log('  /login - Вход в систему');
            console.log('  /register - Регистрация');
            console.log('  / - Конвертер валют');
            console.log('  /rates - Мои курсы валют');
            console.log('  /history - История конвертаций');
            console.log('  /admin/rates - Редактор курсов');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer().catch(console.error);