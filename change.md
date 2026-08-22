Inspect the existing FUW E-Library authentication files and implement the username/password registration and login using the lookup_login_email and register_identity_check Supabase RPCs created by the migration. Find the existing Login and Register components, replace the old email/OTP authentication logic, preserve the existing AuthContext, session handling, protected routes, student/admin role detection, redirects, UI, validation, and logout functionality. Do not create duplicate authentication components or Supabase clients. Run the build and fix any errors.

Login page

Use this code in your existing Login component:

const handleLogin = async (e) => {
  e.preventDefault();

  setError('');
  setLoading(true);

  try {
    const { data: email, error: lookupError } =
      await supabase.rpc('lookup_login_email', {
        p_username: username
      });

    if (lookupError || !email) {
      setError('Invalid username or password');
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setError('Invalid username or password');
      return;
    }

    // IMPORTANT:
    // Keep your existing role-checking and dashboard redirect
    // code here. Do not replace it with a hardcoded student/admin redirect.

  } catch (error) {
    setError('Unable to login. Please try again.');
  } finally {
    setLoading(false);
  }
};

Register page

Use this in your existing Register component:


const handleRegister = async (e) => {
  e.preventDefault();

  setError('');
  setLoading(true);

  try {
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const { data: availability, error: checkError } =
      await supabase.rpc('register_identity_check', {
        p_username: username,
        p_email: email
      });

    if (checkError) {
      setError('Unable to check account information');
      return;
    }

    if (availability.username_taken) {
      setError('Username is already taken');
      return;
    }

    if (availability.email_taken) {
      setError('Email is already registered');
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          full_name: fullName,
          display_name: fullName
        }
      }
    });

    if (error) {
      setError(error.message);
      return;
    }

    // Keep your existing successful-registration behavior here.

  } catch (error) {
    setError('Unable to create account. Please try again.');
  } finally {
    setLoading(false);
  }
};

Also write all the tables, rows, columbs literally all the data's i need to create in supabase that are not yet created i need to create in the database in the README.md
