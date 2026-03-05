import styled from "styled-components";
import { HiXMark } from "react-icons/hi2";
import {
  createContext,
  useContext,
  useState,
  cloneElement,
  useEffect,
} from "react";
import { createPortal } from "react-dom";

const StyledModal = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--color-grey-0);
  border-radius: 20px;
  box-shadow: var(--shadow-lg);
  padding: 2rem;
  transition: all 0.3s;
  overflow-y: auto;

  width: ${(props) => (props.$size === "small" ? "90%" : "90%")};
  height: ${(props) => (props.$size === "small" ? "auto" : "90%")};
  max-width: ${(props) => (props.$size === "small" ? "90vw" : "90vw")};
  max-height: ${(props) => (props.$size === "small" ? "80vh" : "90vh")};

  display: flex;
  flex-direction: column;
`;

const ModalContent = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`;

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  background-color: var(--backdrop-color);
  backdrop-filter: blur(4px);
  z-index: 1000;
  transition: all 0.3s;
`;

const Button = styled.button`
  background: none;
  border: none;
  padding: 0.4rem;
  border-radius: 50%;
  transition: all 0.2s;
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 1;

  &:hover {
    background-color: var(--color-grey-200);
  }

  & svg {
    width: 2rem;
    height: 2rem;
    color: var(--color-grey-500);
  }
`;

const ModalContext = createContext();

function MobileModal({ children }) {
  const [openName, setOpenName] = useState("");
  useEffect(() => {
    if (openName) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [openName]);
  const close = () => setOpenName("");
  const open = setOpenName;
  return (
    <ModalContext.Provider value={{ close, open, openName }}>
      {children}
    </ModalContext.Provider>
  );
}

function Open({ children, opens: opensWindowName }) {
  const { open } = useContext(ModalContext);
  return cloneElement(children, { onClick: () => open(opensWindowName) });
}

function Window({ children, name, size = "large" }) {
  const { openName, close } = useContext(ModalContext);

  if (name !== openName) return null;

  return createPortal(
    <Overlay>
      <StyledModal $size={size}>
        <Button onClick={close}>
          <HiXMark />
        </Button>
        <ModalContent>
          {cloneElement(children, { onCloseModal: close })}
        </ModalContent>
      </StyledModal>
    </Overlay>,
    document.body
  );
}

MobileModal.Window = Window;
MobileModal.Open = Open;

export default MobileModal;
