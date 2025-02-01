require('dotenv').config();
const express = require('express');
const exphbs = require('express-handlebars');
const mysql = require('mysql2');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');



const app = express();
const port = process.env.PORT || 3000;

const secretKey = crypto.randomBytes(64).toString('hex');
console.log(secretKey);

require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);



app.engine('hbs', exphbs.engine({ extname: '.hbs' }));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));


app.use(express.static(path.join(__dirname, 'public')));

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: secretKey, resave: false, saveUninitialized: true }));




const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) throw err;
  console.log('Connected to MySQL Database');
});

//index.hbs
app.get('/', (req, res) => {
  const query = 'SELECT * FROM doctors WHERE rating > 80';
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    res.render('index', { user: req.session.user || null, doctors: results, layout: false });
  });
});

//doctor.hbs
app.get('/doctor/:id', (req, res) => {
  const doctorId = req.params.id;

  const doctorQuery = 'SELECT * FROM doctors WHERE id = ?';

  const hospitalQuery = `
    SELECT h.name, h.address 
    FROM doctor_hospital dh
    JOIN hospitals h ON dh.hospital_id = h.id
    WHERE dh.doctor_id = ?
  `;

  db.query(doctorQuery, [doctorId], (err, doctorResults) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    if (doctorResults.length === 0) {
      return res.status(404).send('Doctor not found');
    }

    db.query(hospitalQuery, [doctorId], (err, hospitalResults) => {
      if (err) {
        return res.status(500).send('Database error');
      }

      res.render('doctor', {
        doctor: { ...doctorResults[0], hospitals: hospitalResults },
        layout: false,
        user: req.session.user || null
      });
    });
  });
});


//hospitals.hbs
app.get('/hospitals', (req, res) => {
  db.query('SELECT * FROM hospitals', (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.render('hospital-list', {user: req.session.user || null, hospitals: results, layout: false });
  });
});

//doctors.hbs
app.get('/doctors', (req, res) => {
  const sql = 'SELECT * FROM doctors';

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching doctors:', err);
      return res.status(500).send('Database query error');
    }
    res.render('doctor-list', {user: req.session.user || null, doctors: results, layout: false });
  });
});

//search.hbs
app.get('/search', (req, res) => {
  const specialtyQuery = 'SELECT DISTINCT specialty FROM doctors';

  db.query(specialtyQuery, (err, specialties) => {
    if (err) {
      console.error('Error fetching specialties:', err);
      return res.status(500).send('Database query error');
    }

    const specialtyOptions = specialties.map(row => row.specialty);

    res.render('search', {user: req.session.user || null, specialtyOptions, layout: false });
  });
});

//medicine.hbs
app.get('/medicine', (req, res) => {
  const query = 'SELECT * FROM medicine WHERE category = "Cancer" LIMIT 6';
  db.query(query, (err, cancerMedicines) => {
    if (err) {
      return res.status(500).send('Database query failed');
    }

    const otherQuery = 'SELECT * FROM medicine WHERE category != "Cancer" LIMIT 6';
    db.query(otherQuery, (err, otherMedicines) => {
      if (err) {
        return res.status(500).send('Database query failed');
      }

      const brandQuery = 'SELECT DISTINCT company_name, image_url FROM medicine ORDER BY RAND() LIMIT 6';
      db.query(brandQuery, (err, brands) => {
        if (err) {
          return res.status(500).send('Database query failed');
        }

        res.render('medicine', {
          user: req.session.user || null,
          cancerMedicines,
          otherMedicines,
          brands,
          layout: false
        });
      });
    });
  });
});

app.use(express.urlencoded({ extended: true }));

//signup.hbs
app.get('/signup', (req, res) => {
  res.render('signup', {layout: false});
});

app.post('/signup', async (req, res) => {
  const { name, user_phone_number, user_email, user_password, confirm_password } = req.body;

  const phoneQuery = 'SELECT * FROM user WHERE user_phone_number = ?';
  db.query(phoneQuery, [user_phone_number], async (err, results) => {
      

      if (user_password !== confirm_password) {
          return res.status(400).send('Passwords do not match. Please confirm your password.');
      }

      const hashedPassword = await bcrypt.hash(user_password, 10);

      const user_id = `USR-${name.toLowerCase().replace(/ /g, '-')}-${Date.now()}`;

      const insertUserQuery = 'INSERT INTO user (user_id, name, user_phone_number, user_email, user_password) VALUES (?, ?, ?, ?, ?)';
      db.query(insertUserQuery, [user_id, name, user_phone_number, user_email, hashedPassword], (err) => {
          if (err) {
              return res.status(500).send('Error registering user');
          }
          res.redirect('/login');
      });
  });
});


//login.hbs
app.get('/login', (req, res) => {
  res.render('login', {layout: false});
});
app.post('/login', async (req, res) => {
  const { user_email, user_password } = req.body;

  const query = 'SELECT * FROM user WHERE user_email = ?';
  db.query(query, [user_email], async (err, results) => {
    if (err) {
      return res.status(500).send('Database error while fetching user');
    }

    if (results.length === 0) {
      return res.status(400).send('Invalid email or password');
    }

    const user = results[0];

    const isPasswordValid = await bcrypt.compare(user_password, user.user_password);
    if (!isPasswordValid) {
      return res.status(400).send('Invalid email or password');
    }

   
    req.session.user = {
      user_id: user.user_id,
      name: user.name,
      user_phone_number: user.user_phone_number,
      user_email: user.user_email
  };
    res.redirect('/');
  });
});


//user.hbs
app.get('/user-profile', (req, res) => {
  if (!req.session.user) {
      return res.redirect('/login');
  }

  const user = req.session.user;

  res.render('user', { user, layout: false });
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
      if (err) {
          return res.status(500).send('Failed to log out');
      }
      res.redirect('/');
  });
});


//emergency.hbs
app.get('/emergency', (req, res) => {
  res.render('emergency', {user: req.session.user || null, layout: false});
});

app.get('/ambulance', (req, res) => {
  res.render('ambulance', {user: req.session.user || null, layout: false});
});



app.get('/reset-password', (req, res) => {
  res.render('reset-password', { layout: false });
});

app.post('/reset-password', async (req, res) => {
  const { phone, password, confirmPassword } = req.body;

  if (!phone || !password || !confirmPassword) {
      return res.render('reset-password', {
          error: 'All fields are required!',
          layout: false
      });
  }

  if (password !== confirmPassword) {
      return res.render('reset-password', {
          error: 'Passwords do not match!',
          layout: false
      });
  }

  try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const query = 'UPDATE user SET user_password = ? WHERE user_phone_number = ?';
      db.query(query, [hashedPassword, phone], (err, result) => {
          if (err) {
              console.error(err);
              return res.render('reset-password', {
                  error: 'Something went wrong. Please try again later.',
                  layout: false
              });
          }

          if (result.affectedRows === 0) {
              return res.render('reset-password', {
                  error: 'Phone number not found!',
                  layout: false
              });
          }

          res.redirect('/login');
      });
  } catch (error) {
      console.error(error);
      res.render('reset-password', {
          error: 'Something went wrong. Please try again later.',
          layout: false
      });
  }
});


//appointment-details.hbs
app.get('/confirm-appointment', (req, res) => {
  const { doctorId, date, hospital } = req.query;

  if (!doctorId || !date || !hospital) {
    return res.status(400).send('Missing required query parameters.');
  }

  db.query('SELECT * FROM doctors WHERE id = ?', [doctorId], (err, doctorRows) => {
    if (err) {
      console.error('Error fetching doctor:', err);
      return res.status(500).send('An error occurred while fetching doctor details.');
    }

    const doctor = doctorRows[0];
    if (!doctor) {
      return res.status(404).send('Doctor not found.');
    }

    db.query('SELECT * FROM hospitals WHERE name = ?', [hospital], (err, hospitalRows) => {
      if (err) {
        console.error('Error fetching hospital:', err);
        return res.status(500).send('An error occurred while fetching hospital details.');
      }

      const hospitalDetails = hospitalRows[0];
      if (!hospitalDetails) {
        return res.status(404).send('Hospital not found.');
      }

      res.render('appointment-details', {
        layout:false,
        doctor,
        hospital: hospitalDetails,
        appointment: { date },
      });
    });
  });
});



app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
