const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME || 'postgres',
    process.env.DB_USER || 'admin',
    process.env.DB_PASSWORD || 'admin',
    {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    username: {
        type: DataTypes.STRING(50),
        unique: true,
        allowNull: false
    },
    password: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            len: [6, 100]
        }
    }
}, {
    timestamps: true, 
    updatedAt: false 
});

const CurrencyRate = sequelize.define('CurrencyRate', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    currencyCode: {
        type: DataTypes.STRING(3),
        allowNull: false,
        validate: {
            isUppercase: true,
            len: [3, 3]
        }
    },
    rate: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        validate: {
            min: 0.0001
        }
    },
    isBase: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

const ConversionHistory = sequelize.define('ConversionHistory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    amount: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false,
        validate: {
            min: 0.0001
        }
    },
    fromCurrency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        validate: {
            isUppercase: true,
            len: [3, 3]
        }
    },
    toCurrency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        validate: {
            isUppercase: true,
            len: [3, 3]
        }
    },
    rate: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        validate: {
            min: 0.0001
        }
    },
    result: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false,
        validate: {
            min: 0.0001
        }
    },
    convertedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

const UserCurrency = sequelize.define('UserCurrency', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    rate: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        validate: {
            min: 0.0001
        }
    }
});

User.hasMany(UserCurrency, { 
    foreignKey: {
        name: 'userId',
        type: DataTypes.UUID,
        allowNull: false
    }
});
UserCurrency.belongsTo(User, { 
    foreignKey: {
        name: 'userId',
        type: DataTypes.UUID,
        allowNull: false
    }
});

UserCurrency.belongsTo(CurrencyRate, { 
    foreignKey: {
        name: 'currencyId',
        type: DataTypes.UUID,
        allowNull: false
    }
});
CurrencyRate.hasMany(UserCurrency, { 
    foreignKey: {
        name: 'currencyId',
        type: DataTypes.UUID,
        allowNull: false
    }
});

User.hasMany(ConversionHistory, { 
    foreignKey: {
        name: 'userId',
        type: DataTypes.UUID,
        allowNull: false
    }
});
ConversionHistory.belongsTo(User, { 
    foreignKey: {
        name: 'userId',
        type: DataTypes.UUID,
        allowNull: false
    }
});

async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Connection to PostgreSQL has been established successfully.');

        await sequelize.sync({ force: process.env.FORCE_SYNC === 'true' });
        console.log('Database synchronized');

        const baseCurrencies = [
            { currencyCode: 'USD', rate: 1.0, isBase: true },
            { currencyCode: 'EUR', rate: 0.85, isBase: false },
            { currencyCode: 'RUB', rate: 73.5, isBase: false },
            { currencyCode: 'CNY', rate: 7.14, isBase: false}
        ];

        for (const currency of baseCurrencies) {
            await CurrencyRate.findOrCreate({
                where: { currencyCode: currency.currencyCode },
                defaults: currency
            });
        }

    } catch (error) {
        console.error('Unable to connect to the database:', error);
        process.exit(1);
    }
}

module.exports = {
    sequelize,
    User,
    CurrencyRate,
    ConversionHistory,
    UserCurrency,
    initializeDatabase
};