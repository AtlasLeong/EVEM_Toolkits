import { useContext, useEffect } from "react";
import { AuthContext } from "../context/AuthContext";
import MobileLogin from "../features/Authentication/MobileLogin";
import MobileSetting from "../features/Settings/MobileSetting";
import { useNavigate } from "react-router-dom";

function MobileUser() {
  const { isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/mobilelogin");
    }
  }, [isAuthenticated, navigate]);
  return <MobileSetting />;
}

export default MobileUser;
